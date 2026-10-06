const Docker = require("dockerode");
const os = require("os");
const net = require("net");
const fs = require("fs");
const path = require("path");

let dockerInstance = null;
const sandboxPorts = new Map();

function getActiveSandboxesFilePath() {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return path.join(dir, "active-sandboxes.json");
}

function persistSandboxPorts(replId, ports) {
  try {
    const file = getActiveSandboxesFilePath();
    let data = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}
    }
    data[replId] = ports;
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("[Docker] Error persisting active sandboxes:", err.message);
  }
}

function removePersistedSandbox(replId) {
  try {
    const file = getActiveSandboxesFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      delete data[replId];
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    }
  } catch {}
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

async function findAvailablePort(startPort) {
  let port = startPort;
  while (!(await isPortFree(port))) {
    port++;
  }
  return port;
}

function getDockerClient() {
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

async function checkDockerAvailability() {
  try {
    const docker = getDockerClient();
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

async function createDockerSandbox({ replId, language = "node-js" }) {
  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();

  if (!available) {
    return {
      replId,
      status: "ERROR",
      appPort: 3002,
      runnerPort: 3001,
      error: "Docker Engine is not running or not accessible.",
    };
  }

  const docker = getDockerClient();
  const runnerImage = process.env.RUNNER_IMAGE || "rikkyj/runner:latest";

  try {
    // Check if running
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
    } catch {}

    let hostAppPort = await findAvailablePort(3002);
    let hostRunnerPort = await findAvailablePort(3001);
    if (hostRunnerPort === hostAppPort) {
      hostRunnerPort = await findAvailablePort(hostAppPort + 1);
    }
    sandboxPorts.set(replId, { appPort: hostAppPort, runnerPort: hostRunnerPort });
    persistSandboxPorts(replId, { appPort: hostAppPort, runnerPort: hostRunnerPort });

    const localWorkspaceDir = path.resolve(process.cwd(), "data", "workspaces", replId);
    if (!fs.existsSync(localWorkspaceDir)) {
      try {
        fs.mkdirSync(localWorkspaceDir, { recursive: true });
      } catch {}
    }

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
        NanoCpus: 1000000000,
        Memory: 512 * 1024 * 1024,
        PidsLimit: 100,
        RestartPolicy: { Name: "no" },
      },
    });

    await container.start();
    return {
      replId,
      containerId: container.id,
      status: "RUNNING",
      appPort: hostAppPort,
      runnerPort: hostRunnerPort,
    };
  } catch (err) {
    return {
      replId,
      status: "ERROR",
      appPort: 3002,
      runnerPort: 3001,
      error: err.message,
    };
  }
}

async function stopDockerSandbox(replId) {
  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();
  if (!available) return;

  const docker = getDockerClient();
  try {
    const container = docker.getContainer(containerName);
    await container.stop({ t: 5 });
    await container.remove({ force: true });
    sandboxPorts.delete(replId);
    removePersistedSandbox(replId);
  } catch (err) {
    console.warn(`[Docker] Stop container warning for ${replId}:`, err.message);
  }
}

async function getDockerSandboxStatus(replId) {
  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();
  if (!available) return { replId, status: "STOPPED" };

  const docker = getDockerClient();
  try {
    const container = docker.getContainer(containerName);
    const inspect = await container.inspect();
    let ports = sandboxPorts.get(replId);
    return {
      replId,
      containerId: inspect.Id,
      status: inspect.State.Running ? "RUNNING" : "STOPPED",
      appPort: ports?.appPort || 3002,
      runnerPort: ports?.runnerPort || 3001,
      containerIp: inspect.NetworkSettings.IPAddress,
    };
  } catch {
    return { replId, status: "STOPPED" };
  }
}

function getDockerSandboxPorts(replId) {
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

module.exports = {
  checkDockerAvailability,
  createDockerSandbox,
  stopDockerSandbox,
  getDockerSandboxStatus,
  getDockerSandboxPorts,
};
