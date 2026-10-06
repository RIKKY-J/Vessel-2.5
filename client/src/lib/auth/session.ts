import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export interface UserSession {
  userId: string;
  email: string;
  name: string;
  isGuest?: boolean;
}

const SESSION_SECRET = process.env.SESSION_SECRET || "vessel-jwt-session-secret-key-98218";
export const SESSION_COOKIE_NAME = "vessel_session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createSessionToken(payload: UserSession): string {
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: payload.isGuest ? "2h" : "7d" });
}

export function verifySessionToken(token: string): UserSession | null {
  try {
    const decoded = jwt.verify(token, SESSION_SECRET) as UserSession;
    if (decoded && decoded.userId && decoded.email) {
      return {
        userId: decoded.userId,
        email: decoded.email,
        name: decoded.name,
        isGuest: !!decoded.isGuest,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions() {
  // Only use secure cookies if explicitly running on HTTPS (e.g. via domain/reverse-proxy)
  // Over plain HTTP (such as http://<EC2-IP>:3000), secure: true causes browsers to reject the cookie!
  const isSecure = process.env.COOKIE_SECURE === "true";

  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  };
}

/**
 * Server-side helper to retrieve the authenticated user in Server Components and Route Handlers.
 */
export async function getAuthenticatedUser(req?: NextRequest): Promise<UserSession | null> {
  // 1. Check req if supplied
  if (req) {
    const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookieToken) {
      const user = verifySessionToken(cookieToken);
      if (user) return user;
    }

    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const user = verifySessionToken(token);
      if (user) return user;
    }
  }

  // 2. Next.js cookies() API
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (token) {
      return verifySessionToken(token);
    }
  } catch {
    // cookies() might not be available in non-request contexts
  }

  return null;
}
