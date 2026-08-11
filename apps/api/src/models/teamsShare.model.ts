import mongoose, { type HydratedDocument, type Model } from 'mongoose';

// No live MS Graph credentials are configured in this environment, so a "share" is not
// actually posted to a real Teams channel — this record captures what WOULD have been
// posted (message, mentions, article count), ready to swap for a real Graph API call
// behind this same shape once OAuth credentials are available.
export interface ITeamsShare {
  orgId: mongoose.Types.ObjectId;
  sharedBy: mongoose.Types.ObjectId;
  message: string;
  mentions: string[];
  articleCount: number;
  simulated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type TeamsShareDocument = HydratedDocument<ITeamsShare>;

const teamsShareSchema = new mongoose.Schema<ITeamsShare>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    mentions: { type: [String], default: [] },
    articleCount: { type: Number, required: true, min: 0 },
    simulated: { type: Boolean, default: true },
  },
  { timestamps: true },
);
teamsShareSchema.index({ orgId: 1, createdAt: -1 });

export const TeamsShareModel =
  (mongoose.models.TeamsShare as Model<ITeamsShare> | undefined) ??
  mongoose.model<ITeamsShare>('TeamsShare', teamsShareSchema);
