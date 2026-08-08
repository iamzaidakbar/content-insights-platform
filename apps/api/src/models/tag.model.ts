import mongoose, { type HydratedDocument, type Model } from 'mongoose';

export interface ITag {
  orgId: mongoose.Types.ObjectId;
  name: string;
  color: string;
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

export type TagDocument = HydratedDocument<ITag>;

const tagSchema = new mongoose.Schema<ITag>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, required: true, trim: true },
    // No tag-to-document association exists yet (Document has no tags field) — this stays
    // 0 for every tag until that association is built; kept as a real counter field (not
    // computed on read) so the shape is ready for it.
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);
tagSchema.index({ orgId: 1, name: 1 }, { unique: true });

export const TagModel =
  (mongoose.models.Tag as Model<ITag> | undefined) ?? mongoose.model<ITag>('Tag', tagSchema);
