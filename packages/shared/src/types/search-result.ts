import type { DocumentId } from '../ids.js';
import type { DocumentFileType } from './document.js';

export interface SearchHit {
  docId: DocumentId;
  title: string;
  score: number;
  highlight: string;
  metadata: Record<string, unknown>;
  fileType: DocumentFileType;
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  page: number;
  size: number;
  took: number;
}
