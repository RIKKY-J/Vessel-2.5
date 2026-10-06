import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { projectService } from "@/services/project.service";

async function resolveProject(idOrReplId: string, userId: string) {
  let project = await projectService.getProjectById(idOrReplId, userId);
  if (!project) {
    project = await projectService.getProjectByReplId(idOrReplId, userId);
  }
  return project;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const project = await resolveProject(params.projectId, user.userId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const project = await resolveProject(params.projectId, user.userId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await projectService.deleteProject(project.id, user.userId);
    return NextResponse.json({ success: true, message: "Project deleted successfully" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
