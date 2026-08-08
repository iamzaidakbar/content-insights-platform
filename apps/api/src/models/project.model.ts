import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IProjectMember {
  userId: mongoose.Types.ObjectId;
  roleId: mongoose.Types.ObjectId;
}

export interface IProject {
  orgId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  members: IProjectMember[];
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectDocument = HydratedDocument<IProject>;

const projectMemberSchema = new mongoose.Schema<IProjectMember>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema<IProject>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: false, trim: true, default: '' },
    members: { type: [projectMemberSchema], default: [] },
  },
  { timestamps: true },
);
projectSchema.index({ orgId: 1, createdAt: -1 });
projectSchema.index({ orgId: 1, 'members.userId': 1 });

export const ProjectModel =
  (mongoose.models.Project as Model<IProject> | undefined) ??
  mongoose.model<IProject>('Project', projectSchema);
