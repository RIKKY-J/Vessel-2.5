import { projectService } from "./project.service";
import { createSandbox, stopSandbox as dockerStopSandbox, getSandboxStatus as dockerGetStatus, getSandboxPorts } from "@/lib/docker";
import { syncFilesToS3, saveProjectFile } from "@/lib/s3/projects";
import { copyTemplateToProject } from "@/lib/s3/templates";
import axios from "axios";

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

    // 1. Provision Docker container
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
    return dockerGetStatus(replId);
  }

  async runCommand(replId: string, command: string, path?: string, content?: string, userId?: string) {
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

    const ports = getSandboxPorts(replId);
    if (ports?.runnerPort) {
      try {
        // Instruct runner to run the process
        await axios.post(
          `http://localhost:${ports.runnerPort}/run`,
          { command, path },
          { timeout: 4000 }
        );
      } catch (err: any) {
        console.warn(`[SandboxService] Runner /run error on port ${ports.runnerPort}:`, err.message);
      }
    }

    return { success: true, command };
  }
}

export const sandboxService = new SandboxService();
