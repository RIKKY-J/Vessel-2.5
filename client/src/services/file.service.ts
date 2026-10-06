import { projectService } from "./project.service";
import { fetchProjectFiles, saveProjectFile, syncFilesToS3 } from "@/lib/s3/projects";

export class FileService {
  async getProjectFiles(replId: string, userId?: string) {
    let project = null;
    if (userId) {
      project = await projectService.getProjectByReplId(replId, userId);
    }
    let files = await fetchProjectFiles(replId);
    if (!files || files.length === 0) {
      const { copyTemplateToProject } = await import("@/lib/s3/templates");
      await copyTemplateToProject(project?.language || "node-js", replId);
      files = await fetchProjectFiles(replId);
    }
    return files;
  }

  async saveFile(replId: string, filePath: string, content: string, userId?: string) {
    if (userId) {
      await projectService.getProjectByReplId(replId, userId);
    }
    await saveProjectFile(replId, filePath, content);
    return { success: true };
  }

  async syncFiles(replId: string, files: { path: string; content: string }[], userId?: string) {
    if (userId) {
      await projectService.getProjectByReplId(replId, userId);
    }
    await syncFilesToS3(replId, files);
    return { success: true, count: files.length };
  }

  async createFolder(replId: string, folderPath: string, userId?: string) {
    if (userId) {
      await projectService.getProjectByReplId(replId, userId);
    }
    const { createProjectFolder } = await import("@/lib/s3/projects");
    await createProjectFolder(replId, folderPath);
    return { success: true };
  }
}

export const fileService = new FileService();
