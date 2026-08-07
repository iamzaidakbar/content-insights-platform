import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import type { OrganizationPlan } from '@content-insights/shared';

export interface IOrganization {
  name: string;
  slug: string;
  plan: OrganizationPlan;
  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationDocument = HydratedDocument<IOrganization>;

const organizationSchema = new mongoose.Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
  },
  { timestamps: true },
);

export const OrganizationModel =
  (mongoose.models.Organization as Model<IOrganization> | undefined) ??
  mongoose.model<IOrganization>('Organization', organizationSchema);
