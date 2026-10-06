import { projectService } from "./project.service";
import { createSandbox, stopSandbox as dockerStopSandbox, getSandboxStatus as dockerGetStatus, getSandboxPorts } from "@/lib/docker";
import { syncFilesToS3, saveProjectFile } from "@/lib/s3/projects";
import { copyTemplateToProject } from "@/lib/s3/templates";
import axios from "axios";

function getBackendUrl(): string | undefined {
  const url = process.env.RENDER_BACKEND_URL || process.env.NEXT_PUBLIC_RUNNER_WS_URL;
  if (!url) return undefined;
  return url.replace(/^ws:\/\//i, "http://").replace(/^wss:\/\//i, "https://").replace(/\/+$/, "");
}

export class SandboxService {
  async startSandbox(replId: string, userId?: string) {
    const project = await projectService.getProjectByReplId(replId, userId);
    if (!project) {
      throw new Error(`Project ${replId} not found`);
    }

    // 0. Ensure starter template files are populated on host
    try {
      await copyTemplateToProject(project.language, replId);
    } catch {}

    // 1. Provision container via Render backend (production on Vercel) or local Docker (local dev)
    const backendUrl = getBackendUrl();
    if (backendUrl) {
      try {
        const res = await axios.post(`${backendUrl}/api/projects/${replId}/start`, {
          language: project.language,
        });
        await projectService.updateStatus(replId, "RUNNING");
        return res.data.sandbox || { replId, status: "RUNNING" };
      } catch (err: any) {
        console.error("[SandboxService] Error starting sandbox on Render backend:", err.message);
        throw new Error(err.response?.data?.error || err.message);
      }
    }

    const sandbox = await createSandbox({
      replId,
      language: project.language,
    });

    // 2. Update status in database
    await projectService.updateStatus(replId, "RUNNING");

    return sandbox;
  }

  async stopSandbox(replId: string, userId?: string) {
    const project = await projectService.getProjectByReplId(replId, userId);
    if (!project) {
      throw new Error(`Project ${replId} not found`);
    }

    const backendUrl = getBackendUrl();
    if (backendUrl) {
      try {
        await axios.post(`${backendUrl}/api/projects/${replId}/stop`);
      } catch {}
      await projectService.updateStatus(replId, "STOPPED");
      return { success: true, message: `Sandbox ${replId} stopped` };
    }

    const ports = getSandboxPorts(replId);
    if (ports?.runnerPort) {
      try {
        // Trigger runner sync before termination
        await axios.post(`http://localhost:${ports.runnerPort}/sync`, { replId }, { timeout: 3000 });
      } catch {
        // Continue stopping container
      }
    }

    // 1. Stop and remove Docker container
    await dockerStopSandbox(replId);

    // 2. Update status in database
    await projectService.updateStatus(replId, "STOPPED");

    return { success: true, message: `Sandbox ${replId} stopped` };
  }

  async getStatus(replId: string, userId?: string) {
    if (userId) {
      await projectService.getProjectByReplId(replId, userId);
    }

    const backendUrl = getBackendUrl();
    if (backendUrl) {
      try {
        const res = await axios.get(`${backendUrl}/api/projects/${replId}/status`);
        return res.data;
      } catch {
        return { replId, status: "STOPPED" };
      }
    }

    return dockerGetStatus(replId);
  }

  async runCommand(
    replId: string,
    command: string,
    path?: string,
    content?: string,
    userId?: string,
    headless: boolean = true
  ) {
    const project = await projectService.getProjectByReplId(replId, userId);
    if (!project) {
      throw new Error(`Project ${replId} not found`);
    }

    // Persist active file if provided
    if (path && content !== undefined) {
      await saveProjectFile(replId, path, content);
    }

    // Update settings with last used command
    await projectService.updateSettings(project.id, { run_command: command });

    const backendUrl = getBackendUrl();
    if (backendUrl) {
      try {
        await axios.post(`${backendUrl}/api/projects/${replId}/run`, { command, path, headless });
      } catch (err: any) {
        console.warn(`[SandboxService] Runner /run error on Render backend:`, err.message);
      }
      return { success: true, command };
    }

    const ports = getSandboxPorts(replId);
    if (ports?.runnerPort) {
      try {
        if (headless === false) {
          // Interactive mode: kill any background process so port 3000 is free for terminal
          await axios.post(
            `http://localhost:${ports.runnerPort}/stop-process`,
            {},
            { timeout: 3000 }
          ).catch(() => {});
        } else {
          // Headless mode: instruct runner to spawn process
          await axios.post(
            `http://localhost:${ports.runnerPort}/run`,
            { command, path },
            { timeout: 4000 }
          );
        }
      } catch (err: any) {
        console.warn(`[SandboxService] Runner /run error on port ${ports.runnerPort}:`, err.message);
      }
    }

    return { success: true, command };
  }
}

export const sandboxService = new SandboxService();
