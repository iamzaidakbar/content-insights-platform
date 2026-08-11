import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { DATE_FORMATS, RESULT_VIEW_MODES } from '@content-insights/shared';
import type {
  DateFormatPreference,
  FacetSortOrder,
  ResultViewMode,
  Theme,
} from '@content-insights/shared';

export interface IUserSettings {
  userId: mongoose.Types.ObjectId;
  orgId: mongoose.Types.ObjectId;
  theme: Theme;
  dateFormat: DateFormatPreference;
  facetSortOrder: FacetSortOrder;
  hideZeroCountFacets: boolean;
  // Keyed by ProjectId, plus a 'default' fallback key — Mixed because the keys are dynamic
  // project ids, not a fixed schema shape (matches the shared UserSettings.cardContentLines
  // Record<string, number> contract).
  cardContentLines: Record<string, number>;
  languagePreference: string;
  defaultResultView: ResultViewMode;
  createdAt: Date;
  updatedAt: Date;
}

export type UserSettingsDocument = HydratedDocument<IUserSettings>;

const userSettingsSchema = new mongoose.Schema<IUserSettings>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
    dateFormat: { type: String, enum: DATE_FORMATS, default: 'MMM D, YYYY' },
    facetSortOrder: {
      type: String,
      enum: ['az', 'za', 'countAsc', 'countDesc'],
      default: 'countDesc',
    },
    hideZeroCountFacets: { type: Boolean, default: false },
    cardContentLines: { type: mongoose.Schema.Types.Mixed, default: () => ({ default: 3 }) },
    languagePreference: { type: String, default: 'en' },
    defaultResultView: { type: String, enum: RESULT_VIEW_MODES, default: 'list' },
  },
  { timestamps: true },
);
userSettingsSchema.index({ userId: 1, orgId: 1 }, { unique: true });

export const UserSettingsModel =
  (mongoose.models.UserSettings as Model<IUserSettings> | undefined) ??
  mongoose.model<IUserSettings>('UserSettings', userSettingsSchema);
