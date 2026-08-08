import type { Job, Worker as BullWorker } from 'bullmq';

import type { OrgId } from '@content-insights/shared';

import type { TextChunk } from '../lib/chunking.js';
import { indexDocumentChunks } from '../lib/elasticsearch.js';
import { DOCUMENT_INDEX_QUEUE, redisConnection, Worker } from '../lib/queue.js';
import { DocumentModel } from '../models/document.model.js';

interface IndexJobData {
  documentId: string;
  orgId: OrgId;
  chunks: TextChunk[];
}

async function processIndexJob(job: Job<IndexJobData>): Promise<void> {
  const { documentId, orgId, chunks } = job.data;

  const doc = await DocumentModel.findById(documentId); // fresh lookup, same as ingest.worker.ts
  if (!doc) {
    return; // deleted or bogus id — nothing to do, don't retry
  }

  try {
    await indexDocumentChunks({
      orgId,
      documentId,
      title: doc.title,
      fileType: doc.fileType,
      ...(doc.projectId !== undefined ? { projectId: doc.projectId } : {}),
      metadata: doc.metadata,
      createdAt: doc.createdAt,
      chunks,
    });
    doc.status = 'indexed';
    await doc.save();
  } catch (err) {
    // A bad ES mapping/connection/bulk failure fails THIS document, not the whole worker.
    doc.status = 'failed';
    doc.metadata = {
      ...doc.metadata,
      error: err instanceof Error ? err.message : 'Elasticsearch indexing failed',
    };
    await doc.save();
  }
}

// In-process, same as startIngestWorker — fine at this scope.
export function startIndexWorker(): BullWorker<IndexJobData> {
  return new Worker<IndexJobData>(DOCUMENT_INDEX_QUEUE, processIndexJob, {
    connection: redisConnection,
  });
}
