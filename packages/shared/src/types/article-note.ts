import type { ArticleId, ArticleNoteId, GroupId, OrgId, UserId } from '../ids.js';

export const ARTICLE_NOTE_VISIBILITIES = ['private', 'group'] as const;
export type ArticleNoteVisibility = (typeof ARTICLE_NOTE_VISIBILITIES)[number];

export const ARTICLE_NOTE_BODY_MAX_LENGTH = 4000;

export interface ArticleNote {
  id: ArticleNoteId;
  orgId: OrgId;
  articleId: ArticleId;
  authorId: UserId;
  authorEmail: string;
  body: string;
  visibility: ArticleNoteVisibility;
  groupId?: GroupId | undefined;
  createdAt: string;
  updatedAt: string;
}
