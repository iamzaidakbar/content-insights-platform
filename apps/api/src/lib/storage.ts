import { mkdir, readFile as fsReadFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Resolved relative to apps/api's cwd (/app/apps/api in the dev container —
// inside the existing whole-repo bind mount, so files persist on the host
// with no dedicated Docker volume). Swapping to S3 later means reimplementing
// only saveFile/readFile below as PutObject/GetObject calls.
const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned.length > 0 ? cleaned : 'file';
}

export function buildFileKey(orgId: string, documentId: string, originalFilename: string): string {
  return `${orgId}/${documentId}/${sanitizeFilename(originalFilename)}`;
}

export function resolveFilePath(fileKey: string): string {
  return path.join(UPLOAD_DIR, fileKey);
}

export async function saveFile(fileKey: string, buffer: Buffer): Promise<void> {
  const filePath = resolveFilePath(fileKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

export async function readFile(fileKey: string): Promise<Buffer> {
  return fsReadFile(resolveFilePath(fileKey));
}
