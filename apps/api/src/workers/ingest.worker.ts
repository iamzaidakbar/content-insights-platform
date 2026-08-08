import type { Job, Worker as BullWorker } from 'bullmq';

import { asOrgId } from '@content-insights/shared';

import { chunkText } from '../lib/chunking.js';
import {
  DOCUMENT_INGEST_QUEUE,
  documentIndexQueue,
  redisConnection,
  Worker,
} from '../lib/queue.js';
import { extractText } from '../lib/text-extraction.js';
import { DocumentModel } from '../models/document.model.js';

interface IngestJobData {
  documentId: string;
}

async function processIngestJob(job: Job<IngestJobData>): Promise<void> {
  const { documentId } = job.data;

  const doc = await DocumentModel.findById(documentId);
  if (!doc) {
    return; // deleted or bogus id — nothing to do, don't retry
  }

  doc.status = 'processing';
  await doc.save();

  try {
    const text = await extractText(doc.fileKey, doc.fileType);
    const chunks = chunkText(text);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // This worker only extracts + chunks now. The index worker owns 'indexed',
    // only after a real Elasticsearch bulk-index call succeeds.
    doc.status = 'chunked';
    doc.metadata = { ...doc.metadata, wordCount, chunkCount: chunks.length };
    await doc.save();

    await documentIndexQueue.add('index', {
      documentId: doc._id.toString(),
      orgId: asOrgId(doc.orgId.toString()),
      chunks,
    });
  } catch (err) {
    // A corrupt/unsupported file fails THIS document, not the whole worker.
    doc.status = 'failed';
    doc.metadata = {
      ...doc.metadata,
      error: err instanceof Error ? err.message : 'Text extraction failed',
    };
    await doc.save();
  }
}

// In-process (same Node process as the Express server) — fine at this scope;
// a real deployment would split this into its own scaled worker process.
export function startIngestWorker(): BullWorker<IngestJobData> {
  return new Worker<IngestJobData>(DOCUMENT_INGEST_QUEUE, processIngestJob, {
    connection: redisConnection,
  });
}
