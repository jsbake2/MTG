import type { User } from "@mtg/shared";
import { query } from "../db/pool.js";
import { env } from "../env.js";
import { hashPassword } from "./passwords.js";

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_admin: boolean;
  avatar_card_id: string | null;
  created_at: string;
}

export function toUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    isAdmin: r.is_admin,
    avatarCardId: r.avatar_card_id ?? null,
    createdAt: r.created_at,
  };
}

export async function setAvatar(userId: string, cardId: string | null): Promise<void> {
  await query("UPDATE users SET avatar_card_id = $1 WHERE id = $2", [cardId, userId]);
}

export async function getAvatarForUser(userId: string): Promise<string | null> {
  const r = (await query<{ avatar_card_id: string | null }>("SELECT avatar_card_id FROM users WHERE id = $1", [userId])).rows[0];
  return r?.avatar_card_id ?? null;
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const r = (await query<UserRow>("SELECT * FROM users WHERE lower(username) = lower($1)", [username])).rows[0];
  return r ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const r = (await query<UserRow>("SELECT * FROM users WHERE id = $1", [id])).rows[0];
  return r ?? null;
}

export async function createUser(opts: {
  username: string;
  displayName: string;
  password: string;
  isAdmin?: boolean;
}): Promise<User> {
  const hash = await hashPassword(opts.password);
  const r = (
    await query<UserRow>(
      `INSERT INTO users (username, display_name, password_hash, is_admin)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [opts.username, opts.displayName || opts.username, hash, opts.isAdmin ?? false],
    )
  ).rows[0]!;
  return toUser(r);
}

export async function listUsers(): Promise<User[]> {
  const rows = (await query<UserRow>("SELECT * FROM users ORDER BY created_at ASC")).rows;
  return rows.map(toUser);
}

// On first boot with no users, create the admin from env so Jason can log in.
export async function ensureAdmin(): Promise<void> {
  const count = Number((await query<{ n: string }>("SELECT count(*)::text AS n FROM users")).rows[0]?.n ?? 0);
  if (count > 0) return;
  await createUser({
    username: env.adminUsername,
    displayName: env.adminUsername,
    password: env.adminPassword,
    isAdmin: true,
  });
  console.log(`[auth] created initial admin user "${env.adminUsername}" — change the password after first login`);
}
