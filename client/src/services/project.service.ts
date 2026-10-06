import {
  findProjectsByUserId,
  findProjectByReplId,
  findProjectById,
  createProject as dbCreateProject,
  updateProjectStatus as dbUpdateProjectStatus,
  updateProjectSettings as dbUpdateProjectSettings,
  deleteProject as dbDeleteProject,
  DbProject,
} from "@/lib/db";
import { copyTemplateToProject } from "@/lib/s3/templates";
import { deleteProjectFiles } from "@/lib/s3/projects";
import { stopSandbox } from "@/lib/docker";

export interface CreateProjectDTO {
  name: string;
  language: string;
  replId?: string;
  runCommand?: string;
}

import { generateReplId } from "@/lib/repl";
export { generateReplId };

export class ProjectService {
  async getUserProjects(userId: string) {
    return findProjectsByUserId(userId);
  }

  async getProjectByReplId(replId: string, userId?: string) {
    const project = await findProjectByReplId(replId);
    if (!project) return null;

    // Authorization check if userId is provided
    if (userId && project.user_id !== userId) {
      throw new Error("Unauthorized: You do not own this project.");
    }

    return project;
  }

  async getProjectById(projectId: string, userId?: string) {
    const project = await findProjectById(projectId);
    if (!project) return null;

    if (userId && project.user_id !== userId) {
      throw new Error("Unauthorized: You do not own this project.");
    }

    return project;
  }

  async createProject(userId: string, dto: CreateProjectDTO) {
    const replId = dto.replId || generateReplId();
    const language = dto.language || "node-js";
    const name = dto.name || replId;

    const defaultCmd = language === "python" ? "python3 main.py" : "node --watch index.js";
    const runCommand = dto.runCommand || defaultCmd;

    // 1. Create database records in MySQL
    const project = await dbCreateProject({
      userId,
      name,
      replId,
      language,
      runCommand,
      port: 3000,
    });

    // 2. Hydrate starter template into S3 code/{replId}/
    try {
      await copyTemplateToProject(language, replId);
    } catch (err) {
      console.warn(`[ProjectService] S3 template copy failed for ${replId}:`, err);
    }

    return project;
  }

  async updateStatus(replId: string, status: string) {
    await dbUpdateProjectStatus(replId, status);
  }

  async updateSettings(projectId: string, settings: { run_command?: string; port?: number }) {
    await dbUpdateProjectSettings(projectId, settings);
  }

  async deleteProject(projectId: string, userId: string) {
    const project = await this.getProjectById(projectId, userId);
    if (!project) {
      throw new Error("Project not found");
    }

    // 1. Stop and remove sandbox container
    try {
      await stopSandbox(project.repl_id);
    } catch (err) {
      console.warn(`[ProjectService] Stop sandbox on delete failed for ${project.repl_id}:`, err);
    }

    // 2. Delete database records
    await dbDeleteProject(projectId);

    // 3. Delete files from S3
    try {
      await deleteProjectFiles(project.repl_id);
    } catch (err) {
      console.warn(`[ProjectService] Delete S3 files failed for ${project.repl_id}:`, err);
    }

    return { success: true };
  }
}

export const projectService = new ProjectService();
