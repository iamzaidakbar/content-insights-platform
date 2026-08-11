import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IRoleAssignment {
  _id: mongoose.Types.ObjectId; // kept — assignments are addressed individually so a
  // single one can be ended/removed without touching the rest of the array.
  roleId: mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId | null; // null = "All" (global) scope
  startDate: Date | null;
  endDate: Date | null; // time-bound except Application Admin, which is never time-bound
}

export interface IUser {
  email: string;
  passwordHash: string;
  displayName?: string;
  orgId: mongoose.Types.ObjectId;
  isActive: boolean;
  roleAssignments: IRoleAssignment[];
  currentGroupId: mongoose.Types.ObjectId | null; // last-selected navbar group; Application
  // Admins may have neither this nor currentProjectId set.
  currentProjectId: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const roleAssignmentSchema = new mongoose.Schema<IRoleAssignment>(
  {
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
  },
  { _id: true },
);

const userSchema = new mongoose.Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: false, trim: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    isActive: { type: Boolean, default: true },
    roleAssignments: { type: [roleAssignmentSchema], default: [] },
    currentGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
    currentProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  },
  { timestamps: true },
);
userSchema.index({ orgId: 1 });

export const UserModel =
  (mongoose.models.User as Model<IUser> | undefined) ?? mongoose.model<IUser>('User', userSchema);
