import type { DashboardId, GroupId, InsightId, OrgId, UserId } from '../ids.js';
import type { ChartType } from './insight.js';

export const DASHBOARD_MAX_INSIGHTS = 3;

export interface DashboardLayoutItem {
  insightId: InsightId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardInsightRef {
  insightId: InsightId;
  insightName: string;
  chartType: ChartType;
}

export interface Dashboard {
  id: DashboardId;
  orgId: OrgId;
  groupId: GroupId;
  ownerId: UserId;
  projectId?: string | null; // ProjectId as string
  name: string;
  insights: DashboardInsightRef[]; // max DASHBOARD_MAX_INSIGHTS, denormalized for list display
  layout: DashboardLayoutItem[];
  createdAt: string;
  updatedAt: string;
}
