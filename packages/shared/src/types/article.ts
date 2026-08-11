import type { ArticleId, OrgId, ProjectId, UserId } from '../ids.js';

export const ARTICLE_SOURCE_TYPES = ['news', 'file_system'] as const;
export type ArticleSourceType = (typeof ARTICLE_SOURCE_TYPES)[number];
// Note: a legacy upstream "External" source type is normalized to 'file_system' at ingest
// time — see article.schema.ts note.

export const ARTICLE_ASSET_KINDS = ['pdf', 'full_text', 'image'] as const;
export type ArticleAssetKind = (typeof ARTICLE_ASSET_KINDS)[number];

export interface ArticleAsset {
  kind: ArticleAssetKind;
  url: string;
  fileSizeBytes?: number | undefined;
}

export interface Article {
  id: ArticleId;
  orgId: OrgId;
  projectId: ProjectId;
  title: string;
  summary: string;
  body: string;
  url?: string | undefined;
  domain: string;
  sourceType: ArticleSourceType;
  publishedAt: string;
  authors: string[];
  // Keyed by Concept.key; values are OR'd within a key. Powers both indexed faceting and
  // Advanced Search taxonomy conditions.
  taxonomyValues: Record<string, string[]>;
  tagIds: string[]; // UserTagId[], kept as string[] to avoid a hard type dependency cycle with user-tag.ts
  assets: ArticleAsset[];
  locationHash: string; // stable identity across re-crawls — required for snapshot saved searches
  hidden: boolean;
  hiddenAt?: string | null;
  hiddenBy?: UserId | null;
  ingestedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const ARTICLE_BULK_ACTIONS = ['hide', 'unhide', 'addTags', 'removeTags'] as const;
export type ArticleBulkAction = (typeof ARTICLE_BULK_ACTIONS)[number];

export interface BulkOperationItemResult {
  id: string;
  success: boolean;
  error?: string;
}

export interface BulkOperationResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: BulkOperationItemResult[];
}
