import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { findUserById } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getAuthenticatedUser(req);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      email: session.email,
      name: user?.name || session.name,
    },
  });
}
