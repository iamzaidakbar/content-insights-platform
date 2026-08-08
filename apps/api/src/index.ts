import { createApp } from './app.js';
import { connectDB } from './db/connect.js';
import { startIndexWorker } from './workers/index.worker.js';
import { startIngestWorker } from './workers/ingest.worker.js';

const port = Number(process.env.API_PORT ?? 4000);

async function main(): Promise<void> {
  await connectDB();
  startIngestWorker();
  startIndexWorker();
  const app = createApp();
  app.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start API server:', error);
  process.exit(1);
});
