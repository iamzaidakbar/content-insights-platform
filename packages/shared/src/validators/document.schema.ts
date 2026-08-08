import { z } from 'zod';

export const documentStatusSchema = z.enum([
  'pending',
  'processing',
  'chunked',
  'indexed',
  'failed',
]);
export const documentFileTypeSchema = z.enum(['pdf', 'docx', 'txt']);

export const documentSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  fileType: documentFileTypeSchema,
  fileSizeBytes: z.number().int().nonnegative(),
  status: documentStatusSchema,
  metadata: z.record(z.unknown()),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DocumentInput = z.infer<typeof documentSchema>;

// Multipart text-field validation for POST /api/documents/upload.
export const uploadDocumentSchema = z.object({
  title: z.string().min(1),
  projectId: z.string().min(1).optional(),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
