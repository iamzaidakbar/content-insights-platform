import { z } from 'zod';

export const documentStatusSchema = z.enum(['pending', 'processing', 'indexed', 'failed']);

export const documentSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  ownerId: z.string().min(1),
  title: z.string().min(1),
  status: documentStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DocumentInput = z.infer<typeof documentSchema>;
