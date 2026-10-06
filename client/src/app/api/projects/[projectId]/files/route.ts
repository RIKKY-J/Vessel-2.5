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

    const files = await fileService.getProjectFiles(replId, user.userId);
    return NextResponse.json(
      { files },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
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
    const { path, content } = body;

    if (!path) {
      return NextResponse.json({ error: "File path is required" }, { status: 400 });
    }

    await fileService.saveFile(replId, path, content ?? "", user.userId);
    return NextResponse.json({ success: true, message: `File ${path} saved` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
