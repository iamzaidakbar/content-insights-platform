import { z } from 'zod';

import { DASHBOARD_MAX_INSIGHTS } from '../types/dashboard.js';

export const dashboardLayoutItemSchema = z
  .object({
    insightId: z.string().min(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  })
  .strict();
export type DashboardLayoutItemInput = z.infer<typeof dashboardLayoutItemSchema>;

// POST /api/dashboards
export const createDashboardSchema = z
  .object({
    groupId: z.string().min(1),
    projectId: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export type CreateDashboardInput = z.infer<typeof createDashboardSchema>;

// PUT /api/dashboards/:id — insightIds/layout capped at DASHBOARD_MAX_INSIGHTS; the
// denormalized `insights` ref list on the entity is resolved server-side from insightIds.
export const updateDashboardSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    insightIds: z.array(z.string().min(1)).max(DASHBOARD_MAX_INSIGHTS).optional(),
    layout: z.array(dashboardLayoutItemSchema).max(DASHBOARD_MAX_INSIGHTS).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateDashboardInput = z.infer<typeof updateDashboardSchema>;
