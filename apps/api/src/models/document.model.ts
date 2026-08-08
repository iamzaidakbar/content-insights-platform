import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import type { DocumentFileType, DocumentStatus } from '@content-insights/shared';

export interface IDocument {
  orgId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  projectId?: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileType: DocumentFileType;
  fileSizeBytes: number;
  // Relative, S3-object-key-shaped path: `{orgId}/{docId}/{filename}`. Set in
  // a second save() after insert, since the real _id doesn't exist until then.
  fileKey: string;
  status: DocumentStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentDocument = HydratedDocument<IDocument>;

const documentSchema = new mongoose.Schema<IDocument>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: String, required: false, trim: true },
    title: { type: String, required: true, trim: true },
    originalFilename: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileType: { type: String, enum: ['pdf', 'docx', 'txt'], required: true },
    fileSizeBytes: { type: Number, required: true, min: 0 },
    fileKey: { type: String, required: false, default: '' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'indexed', 'failed'],
      default: 'pending',
    },
    // Function default, not a shared object literal.
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true },
);
documentSchema.index({ orgId: 1, createdAt: -1 });

export const DocumentModel =
  (mongoose.models.Document as Model<IDocument> | undefined) ??
  mongoose.model<IDocument>('Document', documentSchema);
