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

import { config } from './config.js';

// Shared by the Queue (producer) and Worker (consumer). BullMQ's Worker hard-requires
// maxRetriesPerRequest: null on its connection (throws at construction otherwise —
// blocking commands need to keep retrying through transient Redis blips). A
// higher-throughput setup would split producer/worker connections; one is simplest here.
export const redisConnection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

// BullMQ queue names must not contain ':' — it's BullMQ's own Redis-key separator.
// Renamed from the pre-Article `document-ingest`/`document-index` convention now that the
// only entity type left is `Article` (see elasticsearch.ts's identical index-naming note).
export const ARTICLE_INGEST_QUEUE = 'article-ingest';
export const ARTICLE_INDEX_QUEUE = 'article-index';

// attempts + exponential backoff: transient failures (ES restart, Redis blip, file lock)
// self-heal without operator action. Completed/failed jobs are pruned so Redis doesn't
// grow unboundedly.
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 5_000 },
};

export const articleIngestQueue = new Queue(ARTICLE_INGEST_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});
export const articleIndexQueue = new Queue(ARTICLE_INDEX_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

/** True when this run is the job's last configured attempt (no more retries follow). */
export function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

export { Worker };
export type { Job };
