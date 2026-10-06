import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { projectService } from "@/services/project.service";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const projects = await projectService.getUserProjects(user.userId);
    return NextResponse.json({ projects });
  } catch (err: any) {
    console.error("[API] GET /api/projects error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, language, replId, runCommand } = body;

    const project = await projectService.createProject(user.userId, {
      name,
      language,
      replId,
      runCommand,
    });

    return NextResponse.json({
      success: true,
      project,
    });
  } catch (err: any) {
    console.error("[API] POST /api/projects error:", err);
    return NextResponse.json({ error: err.message || "Failed to create project" }, { status: 500 });
  }
}
