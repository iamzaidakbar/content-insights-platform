import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { DASHBOARD_MAX_INSIGHTS } from '@content-insights/shared';

export interface IDashboardInsight {
  insightId: mongoose.Types.ObjectId;
}

export interface IDashboardLayoutItem {
  insightId: mongoose.Types.ObjectId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IDashboard {
  orgId: mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId | null;
  name: string;
  insights: IDashboardInsight[];
  layout: IDashboardLayoutItem[];
  createdAt: Date;
  updatedAt: Date;
}

export type DashboardDocument = HydratedDocument<IDashboard>;

const dashboardInsightSchema = new mongoose.Schema<IDashboardInsight>(
  { insightId: { type: mongoose.Schema.Types.ObjectId, ref: 'Insight', required: true } },
  { _id: false },
);

const dashboardLayoutItemSchema = new mongoose.Schema<IDashboardLayoutItem>(
  {
    insightId: { type: mongoose.Schema.Types.ObjectId, ref: 'Insight', required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    w: { type: Number, required: true },
    h: { type: Number, required: true },
  },
  { _id: false },
);

const dashboardSchema = new mongoose.Schema<IDashboard>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    name: { type: String, required: true, trim: true },
    insights: {
      type: [dashboardInsightSchema],
      default: [],
      // Defense-in-depth only — the DASHBOARD_MAX_INSIGHTS cap is primarily enforced in
      // route logic (dashboard.routes.ts), not here.
      validate: {
        validator: (value: IDashboardInsight[]) => value.length <= DASHBOARD_MAX_INSIGHTS,
        message: `insights exceeds the maximum of ${DASHBOARD_MAX_INSIGHTS}`,
      },
    },
    layout: { type: [dashboardLayoutItemSchema], default: [] },
  },
  { timestamps: true },
);
dashboardSchema.index({ orgId: 1, groupId: 1, createdAt: -1 });

export const DashboardModel =
  (mongoose.models.Dashboard as Model<IDashboard> | undefined) ??
  mongoose.model<IDashboard>('Dashboard', dashboardSchema);
