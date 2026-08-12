# syntax=docker/dockerfile:1.7
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------------------------------------------------------------------------
# Development (docker-compose) — bind-mounts source; builds shared at start.
# ---------------------------------------------------------------------------
FROM base AS dev
WORKDIR /app

# Every workspace package's package.json must be present for pnpm to resolve
# pnpm-lock.yaml, even though this image only runs apps/api.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

# Rest of the repo — superseded by docker-compose's bind mount in the normal
# dev flow, but keeps `docker build && docker run` usable standalone.
COPY . .

WORKDIR /app/apps/api
EXPOSE 4000

# packages/shared has no dist/ yet at container start (the bind mount just
# overlaid /app with the host's unbuilt source, hiding anything a build-time
# RUN step would have produced). Build it once here, at container start,
# before starting the watcher.
CMD ["sh", "-c", "pnpm --filter @content-insights/shared run build && pnpm run dev"]

# ---------------------------------------------------------------------------
# Production — build shared + api, run compiled JS as non-root.
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm --filter @content-insights/shared build \
  && pnpm --filter @content-insights/api build

FROM base AS production
WORKDIR /app

RUN groupadd --system --gid 1001 cip \
  && useradd --system --uid 1001 --gid cip --create-home cip

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

# Prod deps only (shared + api runtime). Shared dist is copied next.
RUN pnpm install --frozen-lockfile --prod

COPY --from=build --chown=cip:cip /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=cip:cip /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=cip:cip /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=cip:cip /app/apps/api/package.json ./apps/api/package.json

RUN mkdir -p /app/apps/api/uploads \
  && chown -R cip:cip /app/apps/api/uploads /app/packages/shared /app/apps/api

ENV NODE_ENV=production
ENV API_PORT=4000
WORKDIR /app/apps/api
USER cip
EXPOSE 4000

CMD ["node", "dist/index.js"]
