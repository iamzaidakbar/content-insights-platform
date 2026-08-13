import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { ARTICLE_NOTE_BODY_MAX_LENGTH, ARTICLE_NOTE_VISIBILITIES } from '@content-insights/shared';
import type { ArticleNoteVisibility } from '@content-insights/shared';

export interface IArticleNote {
  orgId: mongoose.Types.ObjectId;
  articleId: mongoose.Types.ObjectId;
  authorId: mongoose.Types.ObjectId;
  body: string;
  visibility: ArticleNoteVisibility;
  groupId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ArticleNoteDocument = HydratedDocument<IArticleNote>;

const articleNoteSchema = new mongoose.Schema<IArticleNote>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: ARTICLE_NOTE_BODY_MAX_LENGTH },
    visibility: { type: String, enum: ARTICLE_NOTE_VISIBILITIES, required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: false, default: null },
  },
  { timestamps: true },
);
articleNoteSchema.index({ orgId: 1, articleId: 1, createdAt: -1 });
articleNoteSchema.index({ orgId: 1, authorId: 1 });

export const ArticleNoteModel =
  (mongoose.models.ArticleNote as Model<IArticleNote> | undefined) ??
  mongoose.model<IArticleNote>('ArticleNote', articleNoteSchema);
