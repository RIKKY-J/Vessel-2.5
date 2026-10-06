import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { sandboxService } from "@/services/sandbox.service";
import { projectService } from "@/services/project.service";

async function resolveReplId(idOrReplId: string, userId: string): Promise<string | null> {
  const byRepl = await projectService.getProjectByReplId(idOrReplId, userId);
  if (byRepl) return byRepl.repl_id;
  const byId = await projectService.getProjectById(idOrReplId, userId);
  return byId ? byId.repl_id : null;
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
    const replId = await resolveReplId(params.projectId, user.userId);
    if (!replId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const status = await sandboxService.getStatus(replId, user.userId);
    const isRunning = status.status === "RUNNING" && !status.error;
    return NextResponse.json({
      success: true,
      ready: isRunning,
      status: status.status,
      appPort: status.appPort,
      runnerPort: status.runnerPort,
      containerId: status.containerId,
      error: status.error,
      statusText: status.error
        ? `Docker Error: ${status.error}`
        : isRunning
        ? "Sandbox running"
        : status.status === "STARTING"
        ? "Container booting runner daemon..."
        : "Sandbox stopped",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
