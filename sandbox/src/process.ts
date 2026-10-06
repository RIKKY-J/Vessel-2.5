import { spawn, ChildProcess } from "child_process";

let activeProcess: ChildProcess | null = null;

export function runUserProcess(command: string): { pid?: number; command: string } {
  // 1. Terminate existing process if any
  if (activeProcess) {
    try {
      console.log(`[Process] Terminating previous process PID: ${activeProcess.pid}`);
      activeProcess.kill("SIGTERM");
    } catch (err) {
      console.warn("[Process] Error terminating previous process:", err);
    }
    activeProcess = null;
  }

  console.log(`[Process] Executing in /workspace: "${command}"`);

  // 2. Spawn user process inside /workspace
  const child = spawn(command, {
    cwd: "/workspace",
    shell: true,
    env: {
      ...process.env,
      PORT: "3000",
      NODE_PATH: "/code/node_modules:/usr/local/lib/node_modules:/workspace/node_modules",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdout?.on("data", (data) => {
    console.log(`[App:stdout] ${data.toString()}`);
  });

  child.stderr?.on("data", (data) => {
    console.warn(`[App:stderr] ${data.toString()}`);
  });

  child.on("exit", (code, signal) => {
    console.log(`[App] Exited with code=${code}, signal=${signal}`);
    if (activeProcess === child) {
      activeProcess = null;
    }
  });

  activeProcess = child;

  return { pid: child.pid, command };
}

export function stopUserProcess() {
  if (activeProcess) {
    try {
      activeProcess.kill("SIGTERM");
    } catch {}
    activeProcess = null;
  }
}
