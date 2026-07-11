// Cookie-based sessions backed by the sessions table. Opaque random token stored
// in an httpOnly cookie; looked up on each request.
import { randomBytes } from "node:crypto";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import type { NextFunction, Request, Response } from "express";
import type { User } from "@mtg/shared";
import { query } from "../db/pool.js";
import { getUserById, toUser } from "./users.js";
import { isProd } from "../env.js";

const COOKIE_NAME = "mtg_session";
const SESSION_DAYS = 30;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionToken?: string;
    }
  }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expires]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function userForToken(token: string): Promise<User | null> {
  const row = (
    await query<{ user_id: string; expires_at: string }>(
      "SELECT user_id, expires_at FROM sessions WHERE token = $1",
      [token],
    )
  ).rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  const u = await getUserById(row.user_id);
  return u ? toUser(u) : null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    }),
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 }),
  );
}

export function readToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const cookies = parseCookie(header);
  return cookies[COOKIE_NAME] ?? null;
}

// Populates req.user if a valid session exists; never blocks.
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req);
  if (token) {
    const user = await userForToken(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  next();
}
