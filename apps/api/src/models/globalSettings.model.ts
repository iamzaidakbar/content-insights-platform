import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import {
  DEFAULT_MAX_SNAPSHOT_ARTICLES,
  DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE,
} from '@content-insights/shared';

export interface IMsTeamsGlobalSettings {
  hideIcons: boolean;
  maxArticlesPerShare: number;
  defaultBulkMessage: string;
}

export interface IArticleFieldMappingSettings {
  titleConceptKey?: string | null;
  locationConceptKey?: string | null;
  publishedDateConceptKey?: string | null;
}

export interface IGlobalSettings {
  // Singleton per org — enforced by the `unique` index below, not just by convention.
  orgId: mongoose.Types.ObjectId;
  maxSnapshotArticles: number;
  msTeams: IMsTeamsGlobalSettings;
  articleFieldMapping: IArticleFieldMappingSettings;
  createdAt: Date;
  updatedAt: Date;
}

export type GlobalSettingsDocument = HydratedDocument<IGlobalSettings>;

const msTeamsGlobalSettingsSchema = new mongoose.Schema<IMsTeamsGlobalSettings>(
  {
    hideIcons: { type: Boolean, default: false },
    maxArticlesPerShare: { type: Number, default: DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE },
    defaultBulkMessage: { type: String, default: '' },
  },
  { _id: false },
);

const articleFieldMappingSettingsSchema = new mongoose.Schema<IArticleFieldMappingSettings>(
  {
    titleConceptKey: { type: String, required: false, default: null },
    locationConceptKey: { type: String, required: false, default: null },
    publishedDateConceptKey: { type: String, required: false, default: null },
  },
  { _id: false },
);

const globalSettingsSchema = new mongoose.Schema<IGlobalSettings>(
  {
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
    },
    maxSnapshotArticles: { type: Number, default: DEFAULT_MAX_SNAPSHOT_ARTICLES },
    msTeams: { type: msTeamsGlobalSettingsSchema, default: () => ({}) },
    articleFieldMapping: { type: articleFieldMappingSettingsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const GlobalSettingsModel =
  (mongoose.models.GlobalSettings as Model<IGlobalSettings> | undefined) ??
  mongoose.model<IGlobalSettings>('GlobalSettings', globalSettingsSchema);
