import { Redis } from 'ioredis';
import { Queue, Worker, type Job } from 'bullmq';

// Unlike jsonwebtoken (which needed a default-import + destructure workaround
// for its CJS exports), bullmq's named exports were verified empirically to
// resolve correctly under Node's ESM loader with the installed version —
// `import { Queue, Worker } from 'bullmq'` works fine at runtime, not just
// in types. Verified via a standalone tsx-run smoke test before writing this.
//
// ioredis: use the named `Redis` export, not the default — the default export
// is a `export { default } from "./Redis"` re-export chain that TS's NodeNext
// default-import synthesis doesn't resolve to a constructable type here
// ("has no construct signatures"), while the named class export is unambiguous.

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL is not set');
}

// Shared by the Queue (producer) and Worker (consumer). BullMQ's Worker hard-requires
// maxRetriesPerRequest: null on its connection (throws at construction otherwise —
// blocking commands need to keep retrying through transient Redis blips). A
// higher-throughput setup would split producer/worker connections; one is simplest here.
export const redisConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// BullMQ queue names must not contain ':' — it's BullMQ's own Redis-key separator.
export const DOCUMENT_INGEST_QUEUE = 'document-ingest';
export const DOCUMENT_INDEX_QUEUE = 'document-index';

export const documentIngestQueue = new Queue(DOCUMENT_INGEST_QUEUE, {
  connection: redisConnection,
});
// Not consumed by anything yet — forward-looking hook, same spirit as requirePermission
// existing fully-built but unattached before this task.
export const documentIndexQueue = new Queue(DOCUMENT_INDEX_QUEUE, { connection: redisConnection });

export { Worker };
export type { Job };
