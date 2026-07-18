# syntax=docker/dockerfile:1.7

# ---------- Stage 1: install deps + build all workspaces ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install monorepo deps (workspaces). Copy manifests first for layer caching.
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install

# Copy source and build shared -> client -> server.
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
RUN npm run build

# Prune to production deps for the runtime image.
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---------- Stage 2: slim runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8477
ENV HOST=0.0.0.0
ENV CLIENT_DIST=/app/client/dist
ENV IMAGE_CACHE_DIR=/data/image-cache

# non-root user + data dir for the image cache.
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid 1001 --home /app app \
 && mkdir -p /data/image-cache \
 && chown -R app:app /data /app

# Runtime artifacts. npm workspaces hoist deps to /app/node_modules; the
# @mtg/shared symlink there points to /app/shared, so ship shared/dist too.
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/shared/package.json ./shared/package.json
COPY --from=build --chown=app:app /app/shared/dist ./shared/dist
COPY --from=build --chown=app:app /app/server/package.json ./server/package.json
COPY --from=build --chown=app:app /app/server/dist ./server/dist
# Bundled fonts for the card-frame compositor (the slim image ships none).
COPY --from=build --chown=app:app /app/server/assets ./server/assets
COPY --from=build --chown=app:app /app/client/dist ./client/dist
COPY --from=build --chown=app:app /app/package.json ./package.json

USER app
VOLUME ["/data"]
EXPOSE 8477

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8477)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
