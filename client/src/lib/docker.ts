import Docker from "dockerode";
import os from "os";
import net from "net";
import fs from "fs";
import path from "path";
import { getLocalWorkspaceDir } from "./s3/projects";
import { copyTemplateToProject } from "./s3/templates";
import { isEcsConfigured } from "./ecs";

function shouldUseEcs(): boolean {
  if (process.env.SANDBOX_PROVIDER === "ecs") return true;
  if (process.env.SANDBOX_PROVIDER === "docker") return false;
  return isEcsConfigured();
}

let dockerInstance: Docker | null = null;
let isDockerAvailable = false;

// In-memory dynamic port tracker for sandboxes
const sandboxPorts: Map<string, { appPort: number; runnerPort: number }> = new Map();

function getActiveSandboxesFilePath(): string {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return path.join(dir, "active-sandboxes.json");
}

function persistSandboxPorts(replId: string, ports: { appPort: number; runnerPort: number }) {
  try {
    const file = getActiveSandboxesFilePath();
    let data: Record<string, { appPort: number; runnerPort: number }> = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}
    }
    data[replId] = ports;
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (err: any) {
    console.warn("[Docker] Error persisting active sandboxes:", err.message);
  }
}

function removePersistedSandbox(replId: string) {
  try {
    const file = getActiveSandboxesFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      delete data[replId];
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    }
  } catch {}
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (!(await isPortFree(port))) {
    port++;
  }
  return port;
}

export function getDockerClient(): Docker {
  if (dockerInstance) return dockerInstance;

  const isWindows = os.platform() === "win32";
  const dockerHost = process.env.DOCKER_HOST;

  if (dockerHost) {
    dockerInstance = new Docker({ host: dockerHost });
  } else if (isWindows) {
    dockerInstance = new Docker({ socketPath: "//./pipe/docker_engine" });
  } else {
    dockerInstance = new Docker({ socketPath: "/var/run/docker.sock" });
  }

  return dockerInstance;
}

export async function checkDockerAvailability(): Promise<boolean> {
  try {
    const docker = getDockerClient();
    await docker.ping();
    isDockerAvailable = true;
    return true;
  } catch (err: any) {
    console.warn(`[Docker] Daemon ping failed (${err.message}).`);
    isDockerAvailable = false;
    return false;
  }
}

export interface SandboxInfo {
  replId: string;
  containerId?: string;
  status: "STOPPED" | "STARTING" | "RUNNING" | "ERROR";
  appPort?: number;
  runnerPort?: number;
  containerIp?: string;
  error?: string;
}

const mockSandboxes = new Map<string, SandboxInfo>();

export async function createSandbox(params: {
  replId: string;
  language?: string;
}): Promise<SandboxInfo> {
  const { replId, language = "node-js" } = params;

  if (shouldUseEcs()) {
    const { createEcsSandbox } = await import("./ecs");
    return createEcsSandbox({ replId, language });
  }

  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();

  if (!available) {
    const info: SandboxInfo = {
      replId,
      status: "ERROR",
      appPort: 3002,
      runnerPort: 3001,
      error: "Docker Engine is not running or not accessible. Run: sudo chmod 666 /var/run/docker.sock",
    };
    mockSandboxes.set(replId, info);
    return info;
  }

  const docker = getDockerClient();
  const runnerImage = process.env.RUNNER_IMAGE || "vessel-runner:latest";

  try {
    // 1. Cleanup any conflicting or stale previous vessel containers on the host
    try {
      const allContainers = await docker.listContainers({ all: true });
      for (const c of allContainers) {
        const isOtherVessel = c.Names.some(
          (n: string) => n.startsWith("/vessel-") && n !== `/${containerName}`
        );
        if (isOtherVessel) {
          console.log(`[Docker] Stopping conflicting previous vessel container: ${c.Names[0]}`);
          try {
            const stale = docker.getContainer(c.Id);
            if (c.State === "running") {
              await stale.stop({ t: 2 });
            }
            await stale.remove({ force: true });
          } catch (e: any) {
            console.warn(`[Docker] Stale container cleanup warning:`, e.message);
          }
        }
      }
    } catch (err: any) {
      console.warn("[Docker] Pre-start container listing warning:", err.message);
    }

    // 2. Check if current container already exists and is running
    try {
      const existing = docker.getContainer(containerName);
      const inspect = await existing.inspect();
      if (inspect.State.Running) {
        const p3000 = inspect.NetworkSettings?.Ports?.["3000/tcp"]?.[0]?.HostPort;
        const p3001 = inspect.NetworkSettings?.Ports?.["3001/tcp"]?.[0]?.HostPort;
        const resolvedPorts = {
          appPort: p3000 ? parseInt(p3000) : 3002,
          runnerPort: p3001 ? parseInt(p3001) : 3001,
        };
        sandboxPorts.set(replId, resolvedPorts);
        persistSandboxPorts(replId, resolvedPorts);

        return {
          replId,
          containerId: inspect.Id,
          status: "RUNNING",
          appPort: resolvedPorts.appPort,
          runnerPort: resolvedPorts.runnerPort,
        };
      }
      await existing.remove({ force: true });
    } catch {
      // Container didn't exist, proceed to create
    }

    // 3. Dynamically allocate free host ports (ensures zero 'port already allocated' errors)
    let hostAppPort = await findAvailablePort(3002);
    let hostRunnerPort = await findAvailablePort(3001);
    if (hostRunnerPort === hostAppPort) {
      hostRunnerPort = await findAvailablePort(hostAppPort + 1);
    }
    sandboxPorts.set(replId, { appPort: hostAppPort, runnerPort: hostRunnerPort });
    persistSandboxPorts(replId, { appPort: hostAppPort, runnerPort: hostRunnerPort });

    // 4. Ensure local workspace directory exists on host with template starter files
    const localWorkspaceDir = path.resolve(getLocalWorkspaceDir(replId));
    if (!fs.existsSync(localWorkspaceDir)) {
      try {
        fs.mkdirSync(localWorkspaceDir, { recursive: true });
        fs.chmodSync(localWorkspaceDir, 0o777);
      } catch {}
    }

    try {
      const existingFiles = fs.readdirSync(localWorkspaceDir);
      if (existingFiles.length === 0) {
        await copyTemplateToProject(language, replId);
      }
    } catch (err: any) {
      console.warn(`[Docker] Pre-mounting template copy warning:`, err.message);
    }

    // 5. Create and start isolated Docker container with workspace mounted
    const container = await docker.createContainer({
      Image: runnerImage,
      name: containerName,
      Env: [
        `REPL_ID=${replId}`,
        `LANGUAGE=${language}`,
        `S3_BUCKET=${process.env.S3_BUCKET || "vessel-storage"}`,
        `AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID || ""}`,
        `AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY || ""}`,
        `AWS_REGION=${process.env.AWS_REGION || "us-east-1"}`,
        `S3_ENDPOINT=${process.env.S3_ENDPOINT || ""}`,
        `RUNNER_PORT=3001`,
        `PORT=3000`,
      ],
      ExposedPorts: {
        "3000/tcp": {},
        "3001/tcp": {},
      },
      HostConfig: {
        Binds: [`${localWorkspaceDir}:/workspace:rw`],
        PortBindings: {
          "3000/tcp": [{ HostPort: hostAppPort.toString() }],
          "3001/tcp": [{ HostPort: hostRunnerPort.toString() }],
        },
        NanoCpus: 1000000000, // 1 core
        Memory: 512 * 1024 * 1024, // 512 MB
        PidsLimit: 100,
        RestartPolicy: { Name: "no" },
      },
    });

    await container.start();
    console.log(`[Docker] Sandbox container ${containerName} started on ports app:${hostAppPort}, runner:${hostRunnerPort}`);

    // Verify container stays running after startup
    await new Promise((r) => setTimeout(r, 600));
    const startInspect = await container.inspect();
    if (!startInspect.State.Running) {
      let exitLogs = "";
      try {
        const logBuf = await container.logs({ stdout: true, stderr: true, tail: 30 });
        exitLogs = logBuf ? logBuf.toString("utf8").trim() : "";
      } catch {}
      const errMsg = `Container exited immediately with code ${startInspect.State.ExitCode}${exitLogs ? `: ${exitLogs}` : ""}`;
      console.warn(`[Docker] ${errMsg}`);
      return {
        replId,
        containerId: container.id,
        status: "ERROR",
        appPort: hostAppPort,
        runnerPort: hostRunnerPort,
        error: errMsg,
      };
    }

    return {
      replId,
      containerId: container.id,
      status: "RUNNING",
      appPort: hostAppPort,
      runnerPort: hostRunnerPort,
    };
  } catch (err: any) {
    console.warn(`[Docker] Failed to start container for ${replId}:`, err);
    const info: SandboxInfo = {
      replId,
      status: "ERROR",
      appPort: 3002,
      runnerPort: 3001,
      error: err.message,
    };
    mockSandboxes.set(replId, info);
    return info;
  }
}

export async function stopSandbox(replId: string): Promise<void> {
  if (shouldUseEcs()) {
    const { stopEcsSandbox } = await import("./ecs");
    await stopEcsSandbox(replId);
    return;
  }

  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();

  if (!available) {
    const s = mockSandboxes.get(replId);
    if (s) s.status = "STOPPED";
    return;
  }

  const docker = getDockerClient();
  try {
    const container = docker.getContainer(containerName);
    await container.stop({ t: 5 });
    await container.remove({ force: true });
    sandboxPorts.delete(replId);
    removePersistedSandbox(replId);
    console.log(`[Docker] Sandbox container ${containerName} stopped and removed.`);
  } catch (err: any) {
    console.warn(`[Docker] Stop container error for ${replId}:`, err.message);
  }
}

export async function getSandboxStatus(replId: string): Promise<SandboxInfo> {
  if (shouldUseEcs()) {
    const { getEcsSandboxStatus } = await import("./ecs");
    return getEcsSandboxStatus(replId);
  }

  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();

  if (!available) {
    const s = mockSandboxes.get(replId);
    return (
      s || {
        replId,
        status: "STOPPED",
      }
    );
  }

  const docker = getDockerClient();
  try {
    const container = docker.getContainer(containerName);
    const inspect = await container.inspect();
    let ports = sandboxPorts.get(replId);
    if (!ports && inspect.NetworkSettings?.Ports) {
      const p3000 = inspect.NetworkSettings.Ports["3000/tcp"]?.[0]?.HostPort;
      const p3001 = inspect.NetworkSettings.Ports["3001/tcp"]?.[0]?.HostPort;
      ports = {
        appPort: p3000 ? parseInt(p3000) : 3002,
        runnerPort: p3001 ? parseInt(p3001) : 3001,
      };
      sandboxPorts.set(replId, ports);
      persistSandboxPorts(replId, ports);
    }

    let errorMsg: string | undefined = undefined;
    if (!inspect.State.Running) {
      if (inspect.State.ExitCode !== 0) {
        let exitLogs = "";
        try {
          const logBuf = await container.logs({ stdout: true, stderr: true, tail: 20 });
          exitLogs = logBuf ? logBuf.toString("utf8").trim() : "";
        } catch {}
        errorMsg = `Container exited with code ${inspect.State.ExitCode}${exitLogs ? `: ${exitLogs}` : ""}`;
      }
    }

    // Check if the runner daemon port is actually accepting connections
    const isPortActive = inspect.State.Running ? !(await isPortFree(ports?.runnerPort || 3001)) : false;

    return {
      replId,
      containerId: inspect.Id,
      status: inspect.State.Running ? (isPortActive ? "RUNNING" : "STARTING") : "STOPPED",
      appPort: ports?.appPort || 3002,
      runnerPort: ports?.runnerPort || 3001,
      containerIp: inspect.NetworkSettings.IPAddress,
      error: errorMsg,
    };
  } catch {
    return {
      replId,
      status: "STOPPED",
    };
  }
}

export function getSandboxPorts(replId: string): { appPort: number; runnerPort: number; containerIp?: string } {
  if (shouldUseEcs()) {
    try {
      const { getEcsSandboxPorts } = require("./ecs");
      const ecsPorts = getEcsSandboxPorts(replId);
      if (ecsPorts) return ecsPorts;
    } catch {}
  }

  const cached = sandboxPorts.get(replId);
  if (cached) return cached;

  try {
    const file = getActiveSandboxesFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data[replId]) return data[replId];
    }
  } catch {}

  return { appPort: 3002, runnerPort: 3001 };
}
