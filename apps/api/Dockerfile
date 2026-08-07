# syntax=docker/dockerfile:1.7
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

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
