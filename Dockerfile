# Multi-stage build (P1): TypeScript is compiled in the builder stage so
# the runtime container boots `node dist/server.js` directly instead of
# paying a ~7 s `npx tsx` JIT pause on every Render cold start.

# ---- builder ----
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .
RUN npx tsc -p tsconfig.json

# ---- runtime ----
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Prod-only deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled JS + runtime assets that the server reads from disk
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data
COPY --from=builder /app/agent_config ./agent_config
COPY --from=builder /app/public ./public

# Writable dirs
RUN mkdir -p exports sessions

EXPOSE 3000
CMD ["node", "dist/server.js"]
