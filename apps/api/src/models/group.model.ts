import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IHardFilterGrant {
  conceptId: mongoose.Types.ObjectId;
  allowedValues: string[];
  denialNote?: string | undefined;
}

export interface ISoftFilterConceptGrant {
  conceptId: mongoose.Types.ObjectId;
  order: number;
}

export interface IGroupDataAccess {
  projectIds: mongoose.Types.ObjectId[];
  hardFilterGrants: IHardFilterGrant[];
  softFilterConcepts: ISoftFilterConceptGrant[];
}

export interface IGroup {
  orgId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  // Roster (userId/roleId pairs) is NOT stored here — it's a derived read-model, resolved
  // server-side by querying User.roleAssignments where groupId matches this group. See
  // Group.members in @content-insights/shared: response-only, never persisted on this doc.
  dataAccess: IGroupDataAccess;
  createdAt: Date;
  updatedAt: Date;
}

export type GroupDocument = HydratedDocument<IGroup>;

const hardFilterGrantSchema = new mongoose.Schema<IHardFilterGrant>(
  {
    conceptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Concept', required: true },
    allowedValues: { type: [String], default: [] },
    denialNote: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const softFilterConceptGrantSchema = new mongoose.Schema<ISoftFilterConceptGrant>(
  {
    conceptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Concept', required: true },
    order: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const groupDataAccessSchema = new mongoose.Schema<IGroupDataAccess>(
  {
    projectIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Project', default: [] },
    hardFilterGrants: { type: [hardFilterGrantSchema], default: [] },
    softFilterConcepts: { type: [softFilterConceptGrantSchema], default: [] },
  },
  { _id: false },
);

const groupSchema = new mongoose.Schema<IGroup>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: false, trim: true, default: '' },
    // Starts empty on POST /api/groups; configured afterward via
    // PUT /api/groups/:id/data-access (see updateGroupDataAccessSchema).
    dataAccess: { type: groupDataAccessSchema, default: () => ({}) },
  },
  { timestamps: true },
);
groupSchema.index({ orgId: 1, createdAt: -1 });

export const GroupModel =
  (mongoose.models.Group as Model<IGroup> | undefined) ??
  mongoose.model<IGroup>('Group', groupSchema);
