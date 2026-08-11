import mongoose, { type HydratedDocument, type Model } from 'mongoose';

// Per-viewer read state for a channel (a SavedSearch with isChannel: true) — "new articles"
// is per-user, so this is kept out of SavedSearchModel itself. One row per (savedSearchId,
// userId) pair, upserted on view.
export interface IChannelView {
  savedSearchId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  lastViewedAt: Date;
  lastSeenResultCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ChannelViewDocument = HydratedDocument<IChannelView>;

const channelViewSchema = new mongoose.Schema<IChannelView>(
  {
    savedSearchId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedSearch', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastViewedAt: { type: Date, required: true },
    lastSeenResultCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);
// One view-state row per user per channel — upsert on view.
channelViewSchema.index({ savedSearchId: 1, userId: 1 }, { unique: true });

export const ChannelViewModel =
  (mongoose.models.ChannelView as Model<IChannelView> | undefined) ??
  mongoose.model<IChannelView>('ChannelView', channelViewSchema);
