import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { ARTICLE_ASSET_KINDS, type ArticleAssetKind, type ArticleSourceType } from '@content-insights/shared';

export interface IArticleAsset {
  kind: ArticleAssetKind;
  url: string;
  fileSizeBytes?: number;
}

export interface IArticle {
  orgId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  title: string;
  summary: string;
  body: string;
  url?: string;
  domain: string;
  sourceType: ArticleSourceType;
  publishedAt: Date;
  authors: string[];
  // Keyed by Concept.key; values are OR'd within a key. Dynamic/admin-defined key set, so
  // this stays Mixed rather than a strict sub-schema — see article.ts note.
  taxonomyValues: Record<string, string[]>;
  tagIds: mongoose.Types.ObjectId[];
  assets: IArticleAsset[];
  // Stable identity across re-crawls — re-ingesting the same content updates this row
  // rather than duplicating it (see the orgId+locationHash unique index below).
  locationHash: string;
  hidden: boolean;
  hiddenAt?: Date | null;
  hiddenBy?: mongoose.Types.ObjectId | null;
  ingestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ArticleDocument = HydratedDocument<IArticle>;

const articleAssetSchema = new mongoose.Schema<IArticleAsset>(
  {
    kind: { type: String, enum: ARTICLE_ASSET_KINDS, required: true },
    url: { type: String, required: true },
    fileSizeBytes: { type: Number, required: false, min: 0 },
  },
  { _id: false },
);

const articleSchema = new mongoose.Schema<IArticle>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String, required: true },
    body: { type: String, required: true },
    url: { type: String, required: false },
    domain: { type: String, required: true, trim: true },
    sourceType: { type: String, enum: ['news', 'file_system'], required: true },
    publishedAt: { type: Date, required: true },
    authors: { type: [String], default: [] },
    // Function default, not a shared object literal.
    taxonomyValues: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    tagIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'UserTag', default: [] },
    assets: { type: [articleAssetSchema], default: [] },
    locationHash: { type: String, required: true, index: true },
    hidden: { type: Boolean, default: false, index: true },
    hiddenAt: { type: Date, required: false, default: null },
    hiddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, default: null },
    ingestedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
// Stable cross-recrawl identity: re-ingesting the same content updates this row.
articleSchema.index({ orgId: 1, locationHash: 1 }, { unique: true });
// Common list/sort query path.
articleSchema.index({ orgId: 1, projectId: 1, publishedAt: -1 });
// "Exclude hidden" filter query path.
articleSchema.index({ orgId: 1, projectId: 1, hidden: 1 });
articleSchema.index({ orgId: 1, sourceType: 1 });
articleSchema.index({ orgId: 1, hidden: 1 });
articleSchema.index({ orgId: 1, tagIds: 1 });

export const ArticleModel =
  (mongoose.models.Article as Model<IArticle> | undefined) ??
  mongoose.model<IArticle>('Article', articleSchema);
