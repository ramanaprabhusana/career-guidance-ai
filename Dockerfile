# Multi-stage build (P1): TypeScript is compiled in the builder stage so the
# runtime container boots `node dist/server.js` directly instead of paying a
# ~7 s `npx tsx` JIT pause on every Render cold start.
#
# IMPORTANT: `better-sqlite3` and `faiss-node` are native modules. We install
# them ONCE in the builder (which has the build toolchain from the full
# dependency install) and then copy `node_modules` forward to the runtime
# stage. `npm ci --omit=dev` in the runtime stage would try to rebuild native
# bindings on `node:20-slim`, which lacks python3/make/g++, and that's what
# broke the first attempt at this multi-stage Dockerfile.

# ---- builder ----
FROM node:20-slim AS builder
WORKDIR /app

# Build deps for native modules (better-sqlite3, faiss-node)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .
RUN npx tsc -p tsconfig.json

# Prune dev deps in place so the copied node_modules is runtime-only.
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data
COPY --from=builder /app/agent_config ./agent_config
COPY --from=builder /app/public ./public

RUN mkdir -p exports sessions

EXPOSE 3000
CMD ["node", "dist/server.js"]
