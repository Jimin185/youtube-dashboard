import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: number;
  name?: string;
  email?: string;
}

const sessionOptions = {
  cookieName: "outbound_session",
  password:
    process.env.APP_SECRET ??
    "dev-only-secret-change-me-please-32chars!!",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
  },
  ttl: 60 * 60 * 24 * 14, // 2주
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/** 로그인된 userId를 반환, 없으면 null */
export async function getUserId(): Promise<number | null> {
  const session = await getSession();
  return session.userId ?? null;
}
