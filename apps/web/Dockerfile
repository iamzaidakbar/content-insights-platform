# syntax=docker/dockerfile:1.7
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------------------------------------------------------------------------
# Development (docker-compose)
# ---------------------------------------------------------------------------
FROM base AS dev
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY . .

WORKDIR /app/apps/web
EXPOSE 5173

CMD ["sh", "-c", "pnpm --filter @content-insights/shared run build && pnpm exec vite --host"]

# ---------------------------------------------------------------------------
# Production — Vite build served by nginx (not deployed to K8s in this phase).
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /app

ARG VITE_API_URL=http://localhost:4000/api
ARG VITE_APP_ENV=production
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_ENV=$VITE_APP_ENV

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm --filter @content-insights/shared build \
  && pnpm --filter @content-insights/web build

FROM nginx:1.27-alpine AS production
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
