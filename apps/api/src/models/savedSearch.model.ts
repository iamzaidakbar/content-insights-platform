import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { SAVED_SEARCH_TYPES } from '@content-insights/shared';
import type { FilterPanelState, SavedSearchType } from '@content-insights/shared';

export interface ISavedSearchShareGrant {
  groupId: mongoose.Types.ObjectId;
}

export interface ISavedSearch {
  orgId: mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  name: string;
  // Derived from `name` (trim -> lowercase -> Unicode NFC) in the pre-validate hook below —
  // never set this directly. Unique across the entire app while isActive (see the partial
  // index below); soft-deleting frees it back up.
  normalizedName: string;
  type: SavedSearchType;
  // Whole FilterPanelState tree stored as-is (Mixed) — deeply nested, evolving shape.
  // Validated at the zod layer (filterPanelStateSchema), not re-modeled as strict Mongoose
  // sub-schemas here.
  filters: FilterPanelState;
  // Only ever populated when type === 'snapshot'.
  snapshotLocationHashes: string[];
  // Soft delete — false frees `name`/`normalizedName` for reuse.
  isActive: boolean;
  isChannel: boolean;
  channelName?: string | null;
  sharedWithGroups: ISavedSearchShareGrant[];
  lastRunAt: Date | null;
  // Org/global count as of lastRunAt; per-viewer "seen" state lives in ChannelViewModel.
  newResultsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SavedSearchDocument = HydratedDocument<ISavedSearch>;

const savedSearchShareGrantSchema = new mongoose.Schema<ISavedSearchShareGrant>(
  { groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true } },
  { _id: false },
);

const savedSearchSchema = new mongoose.Schema<ISavedSearch>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true },
    type: { type: String, enum: SAVED_SEARCH_TYPES, required: true },
    filters: { type: mongoose.Schema.Types.Mixed, required: true },
    snapshotLocationHashes: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    isChannel: { type: Boolean, default: false },
    channelName: { type: String, required: false, trim: true, default: null },
    sharedWithGroups: { type: [savedSearchShareGrantSchema], default: [] },
    lastRunAt: { type: Date, default: null },
    newResultsCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// normalizedName is derived, never client-supplied — compute it here so every save() path
// (create, rename, restore, ...) stays consistent without callers remembering to set it
// themselves. Mongoose 9's pre-hook signature is synchronous/promise-based (no `next`
// callback param) — see node_modules/mongoose/types/middlewares.d.ts PreMiddlewareFunction.
savedSearchSchema.pre('validate', function () {
  if (typeof this.name === 'string') {
    this.normalizedName = this.name.trim().toLowerCase().normalize('NFC');
  }
});

// Active saved-search/channel names are unique ACROSS THE ENTIRE APP, not just per-org —
// deliberately no orgId in this index. Partial on isActive so soft-deleting (isActive:
// false) immediately frees the name for reuse anywhere.
savedSearchSchema.index(
  { normalizedName: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
// Group-scoped listing ("list mine" within an org/group).
savedSearchSchema.index({ orgId: 1, groupId: 1 });
// "list channels" org-wide.
savedSearchSchema.index({ isChannel: 1, orgId: 1 });

export const SavedSearchModel =
  (mongoose.models.SavedSearch as Model<ISavedSearch> | undefined) ??
  mongoose.model<ISavedSearch>('SavedSearch', savedSearchSchema);
