import type { OrgId } from '../ids.js';

export type OrganizationPlan = 'free' | 'pro' | 'enterprise';

export interface Organization {
  id: OrgId;
  name: string;
  slug: string;
  plan: OrganizationPlan;
  /** Email domain (e.g. "acme.com") whose SSO logins auto-provision into this org. */
  ssoDomain?: string;
  createdAt: string;
  updatedAt: string;
}

// GET /api/organizations/:orgId's response shape — adds a computed memberCount on top of
// the base Organization DTO. Deliberately NOT folded into Organization itself: that base
// type is returned by orgContext on every authenticated request (register/login/refresh/
// most routes), and computing a member count on every one of those would mean an extra
// DB query per request for a number only the Settings page's Organization section needs.
export interface OrganizationDetail extends Organization {
  memberCount: number;
}
