import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { fileService } from "@/services/file.service";
import { projectService } from "@/services/project.service";

async function resolveReplId(idOrReplId: string, userId: string): Promise<string | null> {
  const byRepl = await projectService.getProjectByReplId(idOrReplId, userId);
  if (byRepl) return byRepl.repl_id;
  const byId = await projectService.getProjectById(idOrReplId, userId);
  return byId ? byId.repl_id : null;
}

export async function POST(
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

    const body = await req.json();
    const { files, folders } = body;

    if (Array.isArray(folders)) {
      for (const folder of folders) {
        if (typeof folder === "string" && folder.trim()) {
          await fileService.createFolder(replId, folder.trim(), user.userId);
        }
      }
    }

    let result = { success: true };
    if (Array.isArray(files) && files.length > 0) {
      result = await fileService.syncFiles(replId, files, user.userId);
    }
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[API] Sync files error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
