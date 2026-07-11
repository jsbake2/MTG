// Centralized environment/config access.
export const env = {
  port: Number(process.env.PORT ?? 8477),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://mtg:mtg@localhost:5432/mtg",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin",
  inviteCode: process.env.INVITE_CODE ?? "",
  imageCacheDir: process.env.IMAGE_CACHE_DIR ?? "./data/image-cache",
  nodeEnv: process.env.NODE_ENV ?? "development",
  clientDist: process.env.CLIENT_DIST ?? "",
} as const;

export const isProd = env.nodeEnv === "production";
