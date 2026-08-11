# Content Insights Platform

Enterprise platform for organization-wide document and incident intelligence: upload and manage documents, record incidents, search everything with full-text and structured filters, build dashboards, and enforce group-scoped RBAC — with audit logging, notifications, and versioning built in.

## Architecture

pnpm workspace monorepo:

| Package | Description |
| --- | --- |
| `apps/api` | Express + TypeScript API — MongoDB (Mongoose), Elasticsearch, Redis/BullMQ workers |
| `apps/web` | React 19 + Vite + Tailwind CSS 4 SPA — TanStack Query, Axios |
| `packages/shared` | Shared domain types, Zod validators, permission keys, branded IDs |

Backing services (via `docker-compose.yml`): MongoDB 8 (single-node replica set), Elasticsearch 8.17, Redis 8.

## Prerequisites

- Node.js >= 22
- pnpm >= 10.30 (`corepack enable` or `npm i -g pnpm`)
- Docker (for MongoDB, Elasticsearch, Redis)

> This repo is a **pnpm** workspace. `npm install` will not work — use `pnpm install`.

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env   # adjust values as needed

# 3. Start backing services (Mongo, Elasticsearch, Redis)
docker compose up -d mongodb elasticsearch redis

# 4. Run everything in dev mode (API on :4000, web on :5173)
pnpm dev
```

Or run the full stack in Docker: `docker compose up`.

### Common scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run all packages in watch mode |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` / `pnpm lint:fix` | Lint |
| `pnpm test` | Run unit tests (Vitest) across packages |
| `pnpm test:e2e` | Playwright E2E (requires running web+API; set `E2E_LIVE=1` for live flows) |

## Features

- **Documents** — upload (PDF, DOCX, TXT, CSV, XLSX, MD, HTML, images), background text extraction + chunked Elasticsearch indexing, versioning with restore, tags, bulk operations, streaming download, preview.
- **Incidents** — structured incident records (severity, category, status, affected systems, owner, resolution) indexed for search alongside documents.
- **Search** — full-text with operators (`simple_query_string`), structured filters, live facet counts, sorting, pagination, highlighting; saved searches, channels, and aggregation dashboards.
- **RBAC** — org-wide and group-scoped roles/permissions enforced on every route; admin UI for members, roles, and groups.
- **Audit log** — every sensitive action (uploads, deletes, edits, searches, permission changes, auth events) recorded and browsable by admins.
- **Notifications** — in-app inbox for processing results, incident updates, and permission changes.
- **Auth** — local email/password with refresh-token rotation and server-side revocation; optional OIDC SSO (Okta / Azure AD / Google) via environment config.

## Environment

See [.env.example](.env.example) for the full annotated list. Required for the API: `MONGODB_URI`, `ELASTICSEARCH_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Optional OIDC SSO: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`.

## Testing

- `packages/shared` — Zod validator unit tests
- `apps/api` — Vitest unit tests (permissions, search query building); optional `pnpm --filter @content-insights/api test:integration` with MongoMemoryServer
- `apps/web` — Vitest + Testing Library component tests
- `e2e/` — Playwright against a running stack (`E2E_LIVE=1 pnpm test:e2e`)

## Ports

| Service | Port |
| --- | --- |
| API | 4000 |
| Web | 5173 |
| MongoDB | 27017 |
| Elasticsearch | 9200 |
| Redis | 6379 |
