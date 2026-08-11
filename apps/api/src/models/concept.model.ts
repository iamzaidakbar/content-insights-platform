import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { CONCEPT_PLACEMENTS, type ConceptPlacement } from '@content-insights/shared';

export interface IConcept {
  orgId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  // Lowercased/trimmed mirror of `name`, used only to enforce case-insensitive uniqueness
  // per project (see the compound index below) — never exposed on the DTO.
  normalizedName: string;
  // Slug, used as the indexed field name; immutable once created (see concept.schema.ts's
  // updateConceptSchema, which omits it from the editable fields).
  key: string;
  placement: ConceptPlacement;
  order: number;
  displayLabel: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ConceptDocument = HydratedDocument<IConcept>;

const conceptSchema = new mongoose.Schema<IConcept>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, lowercase: true, trim: true },
    key: { type: String, required: true, trim: true },
    placement: { type: String, enum: CONCEPT_PLACEMENTS, default: 'soft' },
    order: { type: Number, default: 0 },
    displayLabel: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);
// Business rule: concept names are unique per project, case-insensitive — enforced here via
// normalizedName (kept in sync with `name` in a pre-validate hook below), not `name` itself.
conceptSchema.index({ projectId: 1, normalizedName: 1 }, { unique: true });
// `key` is the indexed field name used elsewhere (e.g. filter layout items with
// kind: 'concept'), so it must also be unique per project.
conceptSchema.index({ projectId: 1, key: 1 }, { unique: true });

// Keeps normalizedName derived from name, and derives key from name when not supplied
// (e.g. programmatic inserts that skip the createConceptSchema layer, which normally
// requires/validates key itself).
// Mongoose 9 pre-hooks are callback-free (return void/Promise<void>, no `next` param) — see
// PreMiddlewareFunction in mongoose's middlewares.d.ts.
conceptSchema.pre('validate', function preValidate() {
  if (this.name) {
    this.normalizedName = this.name.toLowerCase().trim();
  }
  if (!this.key && this.name) {
    this.key = this.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
});

export const ConceptModel =
  (mongoose.models.Concept as Model<IConcept> | undefined) ??
  mongoose.model<IConcept>('Concept', conceptSchema);
