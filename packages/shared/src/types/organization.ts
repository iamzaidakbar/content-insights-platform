import type { OrgId } from '../ids.js';

export type OrganizationPlan = 'free' | 'pro' | 'enterprise';

export interface Organization {
  id: OrgId;
  name: string;
  slug: string;
  plan: OrganizationPlan;
  createdAt: string;
  updatedAt: string;
}
