import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IAppearanceSettings {
  theme: 'light' | 'dark' | 'system';
  fontSize: 'small' | 'medium' | 'large';
  compactSidebar: boolean;
  cardDensity: 'comfortable' | 'compact' | 'cozy';
}

export interface IDateRangeFilter {
  start?: string;
  end?: string;
}

export interface ISearchFilters {
  dateRange: IDateRangeFilter;
  sources: string[];
  contentType: 'news' | 'document' | 'report' | null;
  tags: string[];
  languages: string[];
  projects: string[];
}

export interface ISearchSettings {
  defaultPageSize: 12 | 24 | 48;
  defaultSort: 'publishDate' | 'relevance' | 'source';
  defaultLayout: '1col' | '2col' | '3col' | 'dense';
  openArticleIn: 'newTab' | 'sameTab' | 'sidePanel';
  // Absent (undefined) until the first Apply Filters / Advanced Search submit — no default,
  // no `required`, so it's simply missing from the document until explicitly $set.
  lastUsedFilters?: ISearchFilters;
}

export interface IInAppAlertSettings {
  breakingNews: boolean;
  tagMatches: boolean;
  system: boolean;
}

export interface INotificationSettings {
  emailDigest: boolean;
  emailDigestFrequency: 'daily' | 'weekly';
  inAppAlerts: IInAppAlertSettings;
}

export interface IUserSettings {
  userId: mongoose.Types.ObjectId;
  orgId: mongoose.Types.ObjectId;
  appearance: IAppearanceSettings;
  search: ISearchSettings;
  notifications: INotificationSettings;
  updatedAt: Date;
}

export type UserSettingsDocument = HydratedDocument<IUserSettings>;

const appearanceSchema = new mongoose.Schema<IAppearanceSettings>(
  {
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'dark' },
    fontSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
    compactSidebar: { type: Boolean, default: false },
    cardDensity: {
      type: String,
      enum: ['comfortable', 'compact', 'cozy'],
      default: 'comfortable',
    },
  },
  { _id: false },
);

// minimize: false everywhere below — Mongoose's default `minimize: true` strips any
// nested field whose value serializes to `{}` (e.g. a cleared dateRange with neither
// start nor end) straight out of toJSON() output. SearchFilters.dateRange is typed as
// always-present (never optional) on the shared DTO, so a client reading
// `lastUsedFilters.dateRange.start` must never hit `dateRange` having vanished entirely.
const dateRangeFilterSchema = new mongoose.Schema<IDateRangeFilter>(
  {
    start: { type: String, required: false },
    end: { type: String, required: false },
  },
  { _id: false, minimize: false },
);

// No top-level `default` on any field here — the whole subdocument is optional and absent
// until the frontend sends a complete SearchFilters object (see flatten.ts's isFlattenable
// guard, which $sets this whole shape atomically rather than merging it field-by-field).
const searchFiltersSchema = new mongoose.Schema<ISearchFilters>(
  {
    dateRange: { type: dateRangeFilterSchema, required: false },
    sources: { type: [String], required: false },
    contentType: { type: String, enum: ['news', 'document', 'report', null], required: false },
    tags: { type: [String], required: false },
    languages: { type: [String], required: false },
    projects: { type: [String], required: false },
  },
  { _id: false, minimize: false },
);

const searchSettingsSchema = new mongoose.Schema<ISearchSettings>(
  {
    defaultPageSize: { type: Number, enum: [12, 24, 48], default: 12 },
    defaultSort: {
      type: String,
      enum: ['publishDate', 'relevance', 'source'],
      default: 'publishDate',
    },
    defaultLayout: { type: String, enum: ['1col', '2col', '3col', 'dense'], default: '3col' },
    openArticleIn: {
      type: String,
      enum: ['newTab', 'sameTab', 'sidePanel'],
      default: 'newTab',
    },
    lastUsedFilters: { type: searchFiltersSchema, required: false },
  },
  { _id: false, minimize: false },
);

const inAppAlertsSchema = new mongoose.Schema<IInAppAlertSettings>(
  {
    breakingNews: { type: Boolean, default: true },
    tagMatches: { type: Boolean, default: true },
    system: { type: Boolean, default: true },
  },
  { _id: false },
);

const notificationSettingsSchema = new mongoose.Schema<INotificationSettings>(
  {
    emailDigest: { type: Boolean, default: false },
    emailDigestFrequency: { type: String, enum: ['daily', 'weekly'], default: 'weekly' },
    inAppAlerts: { type: inAppAlertsSchema, default: () => ({}) },
  },
  { _id: false },
);

// Deliberately only `updatedAt` (no `createdAt`), matching the literal spec exactly —
// every other model in this codebase uses the full `{ timestamps: true }` pair, so this
// is a one-off intentional deviation, not an oversight.
const userSettingsSchema = new mongoose.Schema<IUserSettings>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    appearance: { type: appearanceSchema, default: () => ({}) },
    search: { type: searchSettingsSchema, default: () => ({}) },
    notifications: { type: notificationSettingsSchema, default: () => ({}) },
  },
  { timestamps: { createdAt: false, updatedAt: true }, minimize: false },
);
userSettingsSchema.index({ userId: 1, orgId: 1 }, { unique: true });

export const UserSettingsModel =
  (mongoose.models.UserSettings as Model<IUserSettings> | undefined) ??
  mongoose.model<IUserSettings>('UserSettings', userSettingsSchema);
