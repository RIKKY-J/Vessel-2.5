import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createUser, findUserByEmail } from "@/lib/db";
import { hashPassword, createSessionToken, getSessionCookieOptions } from "@/lib/auth/session";
import { projectService } from "@/services/project.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    let language = "node-js";
    try {
      const body = await req.json();
      if (body?.language) {
        language = body.language === "python" ? "python" : "node-js";
      }
    } catch {
      // Body may be empty, default to node-js
    }

    // 1. Create a transient guest user identity
    const randomSuffix = crypto.randomBytes(4).toString("hex");
    const guestEmail = `guest_${Date.now().toString(36)}_${randomSuffix}@guest.vessel.dev`;
    const guestPasswordHash = await hashPassword(`guest_secret_${randomSuffix}`);

    const user = await createUser({
      email: guestEmail,
      password_hash: guestPasswordHash,
      name: "Guest Explorer",
    });

    // 2. Provision an instant demo sandbox project
    const guestReplId = `demo-${randomSuffix}`;
    const project = await projectService.createProject(user.id, {
      replId: guestReplId,
      name: `Demo Sandbox (${language === "python" ? "Python" : "Node.js"})`,
      language,
    });

    // 3. Issue guest session token with isGuest: true
    const token = createSessionToken({
      userId: user.id,
      email: user.email,
      name: "Guest Explorer",
      isGuest: true,
    });

    const response = NextResponse.json({
      success: true,
      replId: project.repl_id,
      user: {
        id: user.id,
        email: user.email,
        name: "Guest Explorer",
        isGuest: true,
      },
    });

    const cookieOpts = getSessionCookieOptions();
    // Guest cookies expire in 2 hours
    response.cookies.set(cookieOpts.name, token, {
      ...cookieOpts,
      maxAge: 2 * 60 * 60,
    });

    return response;
  } catch (err: any) {
    console.error("[Auth] Guest session creation error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to initialize guest sandbox" },
      { status: 500 }
    );
  }
}
