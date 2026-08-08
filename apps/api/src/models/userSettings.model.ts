import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IAppearanceSettings {
  theme: 'light' | 'dark' | 'system';
  fontSize: 'small' | 'medium' | 'large';
  compactSidebar: boolean;
  cardDensity: 'comfortable' | 'compact' | 'cozy';
}

export interface ISearchSettings {
  defaultPageSize: 12 | 24 | 48;
  defaultSort: 'publishDate' | 'relevance' | 'source';
  defaultLayout: '1col' | '2col' | '3col' | 'dense';
  openArticleIn: 'newTab' | 'sameTab' | 'sidePanel';
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
  },
  { _id: false },
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
  { timestamps: { createdAt: false, updatedAt: true } },
);
userSettingsSchema.index({ userId: 1, orgId: 1 }, { unique: true });

export const UserSettingsModel =
  (mongoose.models.UserSettings as Model<IUserSettings> | undefined) ??
  mongoose.model<IUserSettings>('UserSettings', userSettingsSchema);
