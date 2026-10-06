import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, claimProject } from "@/lib/db";
import { verifyPassword, createSessionToken, getSessionCookieOptions } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, claimReplId } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await findUserByEmail(cleanEmail);
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // If user was previously working in a guest sandbox, claim and attach it to their account
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
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    const cookieOpts = getSessionCookieOptions();
    response.cookies.set(cookieOpts.name, token, cookieOpts);

    return response;
  } catch (err: any) {
    console.error("[Auth] Login error:", err);
    return NextResponse.json({ error: err.message || "Authentication failed" }, { status: 500 });
  }
}
