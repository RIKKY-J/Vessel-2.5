import { getAuthenticatedUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { projectService } from "@/services/project.service";
import ProjectsDashboard from "@/components/projects/ProjectsDashboard";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect("/signin");
  }

  const projects = await projectService.getUserProjects(user.userId);

  // Serialize timestamps for client component
  const serializedProjects = projects.map((p) => ({
    ...p,
    created_at: p.created_at ? new Date(p.created_at).toISOString() : undefined,
    updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : undefined,
  }));

  return <ProjectsDashboard initialProjects={serializedProjects} user={user} />;
}
