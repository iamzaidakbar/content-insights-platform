import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import {
  ENTITY_MAPPING_STATUSES,
  UPSTREAM_ENTITY_TYPES,
  type EntityMappingStatus,
  type UpstreamEntityType,
} from '@content-insights/shared';

export interface IEntityMappingEntry {
  // Kept (unlike Group.members) — entries are addressed individually via
  // PUT /api/entity-mapping/:upstreamSystem/entries/:entryId.
  _id: mongoose.Types.ObjectId;
  upstreamType: UpstreamEntityType;
  upstreamId: string;
  upstreamName: string;
  localType: UpstreamEntityType;
  localId: string | null;
  localName?: string | null;
  lastSyncedAt: Date | null;
  status: EntityMappingStatus;
}

export interface IEntityMapping {
  orgId: mongoose.Types.ObjectId;
  upstreamSystem: string;
  entries: IEntityMappingEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export type EntityMappingDocument = HydratedDocument<IEntityMapping>;

const entityMappingEntrySchema = new mongoose.Schema<IEntityMappingEntry>(
  {
    upstreamType: { type: String, enum: UPSTREAM_ENTITY_TYPES, required: true },
    upstreamId: { type: String, required: true },
    upstreamName: { type: String, required: true },
    localType: { type: String, enum: UPSTREAM_ENTITY_TYPES, required: true },
    localId: { type: String, required: false, default: null },
    localName: { type: String, required: false, default: null },
    lastSyncedAt: { type: Date, required: false, default: null },
    status: { type: String, enum: ENTITY_MAPPING_STATUSES, default: 'unmapped' },
  },
  { _id: true },
);

const entityMappingSchema = new mongoose.Schema<IEntityMapping>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    upstreamSystem: { type: String, required: true, trim: true },
    entries: { type: [entityMappingEntrySchema], default: [] },
  },
  { timestamps: true },
);
// One mapping document per org per upstream system (singleton, addressed by
// :upstreamSystem in the route path).
entityMappingSchema.index({ orgId: 1, upstreamSystem: 1 }, { unique: true });

export const EntityMappingModel =
  (mongoose.models.EntityMapping as Model<IEntityMapping> | undefined) ??
  mongoose.model<IEntityMapping>('EntityMapping', entityMappingSchema);
