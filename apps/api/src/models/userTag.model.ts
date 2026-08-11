import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { USER_TAG_NAME_MAX_LENGTH } from '@content-insights/shared';

export interface IUserTagShareGrant {
  groupId: mongoose.Types.ObjectId;
  canUse: boolean;
  canDelete: boolean;
}

export interface IUserTag {
  orgId: mongoose.Types.ObjectId;
  name: string;
  // Lowercased/trimmed mirror of `name`, used only to enforce a case-insensitive unique
  // index per org — Mongoose/MongoDB have no native collation-free way to do this on `name`
  // itself. Never read/written directly outside this model.
  normalizedName: string;
  ownerGroupId: mongoose.Types.ObjectId;
  isPrivate: boolean;
  isPublished: boolean;
  createdBy: mongoose.Types.ObjectId;
  sharedWithGroups: IUserTagShareGrant[];
  articleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type UserTagDocument = HydratedDocument<IUserTag>;

const userTagShareGrantSchema = new mongoose.Schema<IUserTagShareGrant>(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    canUse: { type: Boolean, required: true, default: false },
    canDelete: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const userTagSchema = new mongoose.Schema<IUserTag>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: USER_TAG_NAME_MAX_LENGTH },
    normalizedName: { type: String, required: true, lowercase: true, trim: true },
    ownerGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    isPrivate: { type: Boolean, required: true, default: false },
    isPublished: { type: Boolean, required: true, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sharedWithGroups: { type: [userTagShareGrantSchema], default: [] },
    articleCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);
// Tags are hard-deleted (no soft-delete field on this model), so a plain unique index is
// correct here — it never has to account for a `deletedAt` carve-out.
userTagSchema.index({ orgId: 1, normalizedName: 1 }, { unique: true });
userTagSchema.index({ orgId: 1, ownerGroupId: 1 });

export const UserTagModel =
  (mongoose.models.UserTag as Model<IUserTag> | undefined) ??
  mongoose.model<IUserTag>('UserTag', userTagSchema);
