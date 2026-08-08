import type { DocumentId, OrgId, UserId } from '../ids.js';

export type DocumentStatus = 'pending' | 'processing' | 'chunked' | 'indexed' | 'failed';
export type DocumentFileType = 'pdf' | 'docx' | 'txt';

export interface Document {
  id: DocumentId;
  orgId: OrgId;
  /** Plain optional string, not a branded/ref'd entity — no Project model exists in this codebase. */
  projectId?: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileType: DocumentFileType;
  fileSizeBytes: number;
  status: DocumentStatus;
  /** Populated by the ingest worker: wordCount/chunkCount on success, error on failure. */
  metadata: Record<string, unknown>;
  createdBy: UserId;
  createdAt: string;
  updatedAt: string;
}
