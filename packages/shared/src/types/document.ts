import type { DocumentId, OrgId, UserId } from '../ids.js';

export type DocumentStatus = 'pending' | 'processing' | 'indexed' | 'failed';

export interface Document {
  id: DocumentId;
  orgId: OrgId;
  ownerId: UserId;
  title: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}
