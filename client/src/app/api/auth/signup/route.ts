import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, createUser, claimProject } from "@/lib/db";
import { hashPassword, createSessionToken, getSessionCookieOptions } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name, claimReplId } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await findUserByEmail(cleanEmail);
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const password_hash = await hashPassword(password);
    const user = await createUser({
      email: cleanEmail,
      password_hash,
      name: name || cleanEmail.split("@")[0],
    });

    // If user was previously working in a guest sandbox, claim and attach it to their permanent account
    if (claimReplId) {
      try {
        await claimProject(claimReplId, user.id);
        console.log(`[Auth] Claimed guest project ${claimReplId} for user ${user.id}`);
      } catch (err: any) {
        console.warn(`[Auth] Could not claim guest project ${claimReplId}:`, err.message);
      }
    }

    const token = createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      claimedReplId: claimReplId || undefined,
    });

    const cookieOpts = getSessionCookieOptions();
    response.cookies.set(cookieOpts.name, token, cookieOpts);

    return response;
  } catch (err: any) {
    console.error("[Auth] Signup error:", err);
    return NextResponse.json({ error: err.message || "Failed to create account" }, { status: 500 });
  }
}
