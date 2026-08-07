import type { DocumentId, OrgId } from '../ids.js';

export interface SearchResult {
  documentId: DocumentId;
  orgId: OrgId;
  title: string;
  snippet: string;
  score: number;
}
