import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile as fsReadFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';

// Resolved relative to apps/api's cwd (/app/apps/api in the dev container —
// inside the existing whole-repo bind mount, so files persist on the host
// with no dedicated Docker volume). Swapping to S3 later means reimplementing
// only the functions below as PutObject/GetObject calls.
const UPLOAD_DIR = path.resolve(process.cwd(), config.uploadDir);

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned.length > 0 ? cleaned : 'file';
}

// Versioned key: each uploaded revision keeps its own immutable file, which is what
// lets version restore work without copying bytes (the restored version's key is
// simply pointed at again).
export function buildFileKey(
  orgId: string,
  documentId: string,
  originalFilename: string,
  version = 1,
): string {
  return `${orgId}/${documentId}/v${version}/${sanitizeFilename(originalFilename)}`;
}

// Multer disk-storage temp area — same volume as UPLOAD_DIR so the final rename is atomic.
export const TMP_UPLOAD_DIR = path.join(UPLOAD_DIR, '.tmp');

export async function ensureTmpUploadDir(): Promise<string> {
  await mkdir(TMP_UPLOAD_DIR, { recursive: true });
  return TMP_UPLOAD_DIR;
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

// Moves an already-on-disk file (e.g. a multer disk-storage temp file) into its
// final keyed location — avoids buffering large uploads through memory.
export async function moveFileIntoStorage(sourcePath: string, fileKey: string): Promise<void> {
  const filePath = resolveFilePath(fileKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await rename(sourcePath, filePath);
  } catch {
    // rename() fails across devices/volumes — fall back to copy + delete.
    await writeFile(filePath, await fsReadFile(sourcePath));
    await rm(sourcePath, { force: true });
  }
}

export function createFileReadStream(fileKey: string): ReadStream {
  return createReadStream(resolveFilePath(fileKey));
}

export async function fileSize(fileKey: string): Promise<number> {
  const s = await stat(resolveFilePath(fileKey));
  return s.size;
}

export async function deleteFile(fileKey: string): Promise<void> {
  await rm(resolveFilePath(fileKey), { force: true });
}
