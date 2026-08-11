import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IGroupDefaultQuery {
  orgId: mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  savedSearchId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type GroupDefaultQueryDocument = HydratedDocument<IGroupDefaultQuery>;

const groupDefaultQuerySchema = new mongoose.Schema<IGroupDefaultQuery>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    savedSearchId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedSearch', required: true },
  },
  { timestamps: true },
);
// One default query per (group, project) pair — "Per group + project landing query".
groupDefaultQuerySchema.index({ groupId: 1, projectId: 1 }, { unique: true });

export const GroupDefaultQueryModel =
  (mongoose.models.GroupDefaultQuery as Model<IGroupDefaultQuery> | undefined) ??
  mongoose.model<IGroupDefaultQuery>('GroupDefaultQuery', groupDefaultQuerySchema);
