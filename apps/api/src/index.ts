import { createApp } from './app.js';
import { connectDB } from './db/connect.js';
import { config } from './lib/config.js';
import { syncAllOrgIndexMappings } from './lib/elasticsearch.js';
import { logger } from './lib/logger.js';
import { startIndexWorker } from './workers/index.worker.js';
import { startIngestWorker, startNewsIngestionSimulator } from './workers/ingest.worker.js';

const port = config.apiPort;

async function main(): Promise<void> {
  await connectDB();
  // Picks up category/location/customFields (and any future additive mapping field) on
  // every org's index, including ones created before that field existed — ensureOrgIndexExists
  // only ever runs once, at org-signup time, so pre-existing orgs would otherwise never see it.
  await syncAllOrgIndexMappings();
  const ingestWorker = startIngestWorker();
  const indexWorker = startIndexWorker();
  // See ingest.worker.ts's own comment: this stands in for a real upstream NEWS feed —
  // purely additive, never required for articles to exist (seed scripts/uploads don't
  // depend on it running).
  const newsSimulatorTimer = startNewsIngestionSimulator();
  const app = createApp();
  const server = app.listen(port, () => {
    logger.info(`API server listening on http://localhost:${port}`);
  });

  // Graceful shutdown: stop accepting connections, let in-flight jobs finish (worker
  // .close() waits for the active job), then exit. A second signal force-exits.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    server.close();
    clearInterval(newsSimulatorTimer);
    void Promise.all([ingestWorker.close(), indexWorker.close()])
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start API server');
  process.exit(1);
});
