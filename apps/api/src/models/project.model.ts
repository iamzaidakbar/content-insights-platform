import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IProject {
  orgId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectDocument = HydratedDocument<IProject>;

const projectSchema = new mongoose.Schema<IProject>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: false, trim: true, default: '' },
  },
  { timestamps: true },
);
projectSchema.index({ orgId: 1, createdAt: -1 });

export const ProjectModel =
  (mongoose.models.Project as Model<IProject> | undefined) ??
  mongoose.model<IProject>('Project', projectSchema);
