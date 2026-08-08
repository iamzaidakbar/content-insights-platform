import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IUser {
  email: string;
  passwordHash: string;
  displayName?: string;
  orgId: mongoose.Types.ObjectId;
  roles: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const userSchema = new mongoose.Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: false, trim: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
  },
  { timestamps: true },
);
userSchema.index({ orgId: 1 });

export const UserModel =
  (mongoose.models.User as Model<IUser> | undefined) ?? mongoose.model<IUser>('User', userSchema);
