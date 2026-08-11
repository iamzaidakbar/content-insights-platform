import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface IFilterLayoutItem {
  kind: 'system' | 'concept';
  // SystemFilterKey when kind='system', Concept.key when kind='concept' — validated at the
  // zod layer (filter-layout.schema.ts), not re-typed here.
  key: string;
  order: number;
  label: string;
}

export interface IFilterLayout {
  orgId: mongoose.Types.ObjectId;
  // null = default layout applied across all projects (see filter-layout.schema.ts).
  projectId: mongoose.Types.ObjectId | null;
  items: IFilterLayoutItem[];
  createdAt: Date;
  updatedAt: Date;
}

export type FilterLayoutDocument = HydratedDocument<IFilterLayout>;

const filterLayoutItemSchema = new mongoose.Schema<IFilterLayoutItem>(
  {
    kind: { type: String, enum: ['system', 'concept'], required: true },
    key: { type: String, required: true, trim: true },
    order: { type: Number, required: true, default: 0 },
    label: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const filterLayoutSchema = new mongoose.Schema<IFilterLayout>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: false,
      default: null,
    },
    items: { type: [filterLayoutItemSchema], default: [] },
  },
  { timestamps: true },
);
// One layout per (org, project) — including projectId: null for the org-wide default
// layout; Mongo unique indexes treat null as a normal (matchable, distinct-checked) value,
// so this still enforces "at most one default layout per org".
filterLayoutSchema.index({ orgId: 1, projectId: 1 }, { unique: true });

export const FilterLayoutModel =
  (mongoose.models.FilterLayout as Model<IFilterLayout> | undefined) ??
  mongoose.model<IFilterLayout>('FilterLayout', filterLayoutSchema);
