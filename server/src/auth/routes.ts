import { Router } from "express";
import { z } from "zod";
import type { AuthResponse } from "@mtg/shared";
import { env } from "../env.js";
import { verifyPassword } from "./passwords.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireAdmin,
  requireAuth,
  setSessionCookie,
} from "./sessions.js";
import { createUser, getUserById, getUserByUsername, listUsers, setAvatar, toUser } from "./users.js";

export const authRouter = Router();

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const row = await getUserByUsername(parsed.data.username);
  if (!row || !(await verifyPassword(parsed.data.password, row.password_hash))) {
    res.status(401).json({ error: "Wrong username or password" });
    return;
  }
  const token = await createSession(row.id);
  setSessionCookie(res, token);
  const response: AuthResponse = { user: toUser(row) };
  res.json(response);
});

const registerSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  displayName: z.string().min(1).max(48),
  password: z.string().min(4).max(200),
  inviteCode: z.string().optional(),
});

// Self-registration is only allowed when INVITE_CODE is set and matches.
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (!env.inviteCode) {
    res.status(403).json({ error: "Self-registration is disabled. Ask the admin to create your account." });
    return;
  }
  if (parsed.data.inviteCode !== env.inviteCode) {
    res.status(403).json({ error: "Invalid invite code" });
    return;
  }
  if (await getUserByUsername(parsed.data.username)) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }
  const user = await createUser({
    username: parsed.data.username,
    displayName: parsed.data.displayName,
    password: parsed.data.password,
  });
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user } satisfies AuthResponse);
});

authRouter.post("/logout", async (req, res) => {
  if (req.sessionToken) await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: req.user } satisfies AuthResponse);
});

// Set (or clear) your profile avatar to a card's art.
const avatarSchema = z.object({ cardId: z.string().uuid().nullable() });
authRouter.put("/avatar", requireAuth, async (req, res) => {
  const parsed = avatarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  await setAvatar(req.user!.id, parsed.data.cardId);
  const row = await getUserById(req.user!.id);
  res.json({ user: row ? toUser(row) : req.user! } satisfies AuthResponse);
});

// --- Admin: provision kids' accounts ---
const createUserSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  displayName: z.string().min(1).max(48),
  password: z.string().min(4).max(200),
  isAdmin: z.boolean().optional(),
});

authRouter.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  res.json({ users: await listUsers() });
});

authRouter.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (await getUserByUsername(parsed.data.username)) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }
  const user = await createUser(parsed.data);
  res.json({ user });
});
