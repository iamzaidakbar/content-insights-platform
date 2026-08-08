import { createApp } from './app.js';
import { connectDB } from './db/connect.js';
import { logger } from './lib/logger.js';
import { startIndexWorker } from './workers/index.worker.js';
import { startIngestWorker } from './workers/ingest.worker.js';

const port = Number(process.env.API_PORT ?? 4000);

async function main(): Promise<void> {
  await connectDB();
  startIngestWorker();
  startIndexWorker();
  const app = createApp();
  app.listen(port, () => {
    logger.info(`API server listening on http://localhost:${port}`);
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start API server');
  process.exit(1);
});
