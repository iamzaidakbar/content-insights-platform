import { Client, errors } from '@elastic/elasticsearch';

import type { TextChunk } from './chunking.js';

// package.json has no "type" field (CJS) and its exports map points both "require" and
// "import" at the same ./index.js — a plain `module.exports = { Client, errors, ... }`
// built from top-level `const { X } = require(...)` destructures. Same shape as bullmq
// (verified working), not jsonwebtoken's (inline require()-as-object-value, broken) or
// ioredis's (default export, no construct signature, broken) shapes. Verified empirically
// via `node -e "import('@elastic/elasticsearch').then(m => console.log(typeof m.Client,
// typeof m.errors))"` — printed "function object", confirming named imports work.

const elasticsearchUrl = process.env.ELASTICSEARCH_URL;
if (!elasticsearchUrl) {
  throw new Error('ELASTICSEARCH_URL is not set');
}

export const esClient = new Client({ node: elasticsearchUrl });

export function getOrgIndexName(orgId: string): string {
  return `ci_${orgId}_documents`;
}

// One ES document per chunk.
export interface EsChunkDocument {
  docId: string;
  orgId: string;
  projectId: string | null;
  title: string;
  content: string;
  chunkIndex: number;
  fileType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  // Forward-looking only: no per-document ACL system exists yet, so every chunk is
  // written with permissions: ['*']. Nothing filters queries by this field yet.
  permissions: string[];
}

function isResourceAlreadyExistsError(err: unknown): boolean {
  return (
    err instanceof errors.ResponseError &&
    err.body?.error?.type === 'resource_already_exists_exception'
  );
}

// Called once, right after an org is created. Idempotent.
export async function ensureOrgIndexExists(orgId: string): Promise<void> {
  const index = getOrgIndexName(orgId);
  const exists = await esClient.indices.exists({ index });
  if (exists) return;

  try {
    await esClient.indices.create({
      index,
      mappings: {
        properties: {
          docId: { type: 'keyword' },
          orgId: { type: 'keyword' },
          projectId: { type: 'keyword' },
          title: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
          content: { type: 'text' },
          chunkIndex: { type: 'integer' },
          fileType: { type: 'keyword' },
          metadata: { type: 'object', enabled: false }, // store, don't index — arbitrary bag
          createdAt: { type: 'date' },
          permissions: { type: 'keyword' },
        },
      },
    });
  } catch (err) {
    if (!isResourceAlreadyExistsError(err)) throw err; // race: created concurrently
  }
}

export interface IndexDocumentChunksParams {
  orgId: string;
  documentId: string;
  title: string;
  fileType: string;
  projectId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  chunks: TextChunk[];
}

// Bulk-indexes one ES doc per chunk. Throws if ANY chunk fails (caller sets
// Document.status = 'failed' on catch, mirroring ingest.worker.ts's convention).
export async function indexDocumentChunks(params: IndexDocumentChunksParams): Promise<void> {
  const { orgId, documentId, title, fileType, projectId, metadata, createdAt, chunks } = params;
  const index = getOrgIndexName(orgId);
  const createdAtIso = createdAt.toISOString();

  const failures: Array<{ status: number; error: unknown }> = [];
  const stats = await esClient.helpers.bulk<TextChunk>({
    datasource: chunks,
    onDocument(chunk) {
      const esDoc: EsChunkDocument = {
        docId: documentId,
        orgId,
        projectId: projectId ?? null,
        title,
        content: chunk.text,
        chunkIndex: chunk.index,
        fileType,
        metadata,
        createdAt: createdAtIso,
        permissions: ['*'],
      };
      // Deterministic per-chunk _id: reprocessing overwrites instead of duplicating.
      return [{ index: { _index: index, _id: `${documentId}_${chunk.index}` } }, esDoc];
    },
    onDrop(dropped) {
      failures.push({ status: dropped.status, error: dropped.error });
    },
  });

  if (stats.failed > 0) {
    throw new Error(
      `Elasticsearch bulk index failed for ${stats.failed}/${chunks.length} chunk(s) of document ${documentId}: ${JSON.stringify(failures[0])}`,
    );
  }
}
