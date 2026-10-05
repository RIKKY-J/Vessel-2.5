import { getAuthenticatedUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { projectService } from "@/services/project.service";
import { fileService } from "@/services/file.service";
import { copyTemplateToProject } from "@/lib/s3/templates";
import IDE from "@/components/workspace/IDE";

export const dynamic = "force-dynamic";

interface ProjectWorkspacePageProps {
  params: {
    projectId: string;
  };
  searchParams: {
    lang?: string;
    language?: string;
  };
}

export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: ProjectWorkspacePageProps) {
  const projectId = params.projectId;
  if (!projectId) {
    redirect("/projects");
  }

  // 1. Authenticate user server-side
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect(`/signin?claim=${encodeURIComponent(projectId)}`);
  }

  // 2. Fetch project metadata and verify project ownership
  let project = await projectService.getProjectByReplId(projectId, user.userId);
  if (!project) {
    project = await projectService.getProjectById(projectId, user.userId);
  }

  // If project doesn't exist yet, create it on-demand for the authenticated user
  if (!project) {
    const lang = searchParams.lang || searchParams.language || "node-js";
    project = await projectService.createProject(user.userId, {
      replId: projectId,
      name: projectId,
      language: lang,
    });
  }

  // 3. Pre-fetch project files from persistent S3 store
  let files = await fileService.getProjectFiles(project.repl_id, user.userId);
  if (!files || files.length === 0) {
    await copyTemplateToProject(project.language, project.repl_id);
    files = await fileService.getProjectFiles(project.repl_id, user.userId);
  }

  return (
    <IDE
      initialProject={{
        id: project.id,
        name: project.name,
        repl_id: project.repl_id,
        language: project.language,
        status: project.status,
        run_command: project.run_command,
      }}
      initialFiles={files}
      user={user}
    />
  );
}
