import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IRole {
  orgId: mongoose.Types.ObjectId;
  name: string;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type RoleDocument = HydratedDocument<IRole>;

const roleSchema = new mongoose.Schema<IRole>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    permissions: { type: [String], default: [] },
  },
  { timestamps: true },
);
roleSchema.index({ orgId: 1, name: 1 }, { unique: true });

export const RoleModel =
  (mongoose.models.Role as Model<IRole> | undefined) ?? mongoose.model<IRole>('Role', roleSchema);
