import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { CHART_TYPES, INSIGHT_NAME_MAX_LENGTH } from '@content-insights/shared';
import type { ChartType } from '@content-insights/shared';

export interface IInsight {
  orgId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId;
  projectIds: mongoose.Types.ObjectId[];
  name: string;
  chartType: ChartType;
  // Mixed — the FilterPanelState snapshot of the Articles result set this insight was
  // built from; validated at the zod layer (createInsightSchema), not re-typed here.
  sourceFilters: Record<string, unknown>;
  // Mixed — fieldMappings + an optional wordCloud sub-object, shape depends on chartType
  // (see shared InsightConfig); validated at the zod layer, not re-typed here.
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type InsightDocument = HydratedDocument<IInsight>;

const insightSchema = new mongoose.Schema<IInsight>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    projectIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Project', default: [] },
    name: { type: String, required: true, trim: true, maxlength: INSIGHT_NAME_MAX_LENGTH },
    chartType: { type: String, enum: CHART_TYPES, required: true },
    sourceFilters: { type: mongoose.Schema.Types.Mixed, required: true },
    config: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
// Insight names are unique per owner (uniqueness constraint is per-user, not per-org).
insightSchema.index({ ownerId: 1, name: 1 }, { unique: true });

export const InsightModel =
  (mongoose.models.Insight as Model<IInsight> | undefined) ??
  mongoose.model<IInsight>('Insight', insightSchema);
