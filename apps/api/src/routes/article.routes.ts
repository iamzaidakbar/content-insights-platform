import { createHash, randomUUID } from 'node:crypto';
import { readFile as fsReadFile, rm } from 'node:fs/promises';
import path from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { z } from 'zod';

import {
  articleBulkRequestSchema,
  asArticleId,
  asArticleNoteId,
  asGroupId,
  asOrgId,
  asProjectId,
  asUserId,
  createArticleNoteSchema,
  filterPanelStateSchema,
  updateArticleNoteSchema,
  type Article,
  type ArticleAssetKind,
  type ArticleBulkAction,
  type ArticleBulkRequestInput,
  type ArticleNote,
  type AuditAction,
  type BulkOperationItemResult,
  type BulkOperationResult,
  type CreateArticleNoteInput,
  type FilterPanelState,
  type Permission,
  type UpdateArticleNoteInput,
} from '@content-insights/shared';

import {
  canAccessArticle,
  hasGlobalPermission,
  hasPermissionInAnyGroup,
  hasPermissionInGroup,
  resolveArticleSearchGrants,
  resolveUserEffectivePermissions,
} from '../lib/article-access.js';
import { asyncHandler } from '../lib/async-handler.js';
import { audit } from '../lib/audit.js';
import { notifyDynamicChannelsForProject } from '../lib/channel-alerts.js';
import { indexArticle, toIndexArticleParams } from '../lib/elasticsearch.js';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { resolveDocumentScope } from '../lib/group-scope.js';
import { logger } from '../lib/logger.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import type { EffectivePermissions } from '../lib/permissions.js';
import { success } from '../lib/response.js';
import { executeArticleSearch } from '../lib/search.js';
import {
  buildFileKey,
  createFileReadStream,
  ensureTmpUploadDir,
  moveFileIntoStorage,
} from '../lib/storage.js';
import { extractText } from '../lib/text-extraction.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { searchRateLimiter, uploadRateLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import { ArticleModel, type ArticleDocument, type IArticleAsset } from '../models/article.model.js';
import { ArticleNoteModel, type ArticleNoteDocument } from '../models/articleNote.model.js';
import { ProjectModel } from '../models/project.model.js';
import { UserTagModel, type UserTagDocument } from '../models/userTag.model.js';
import type { AuthenticatedUser } from '../types/express.js';

export const articleRouter = express.Router();

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const EXPORT_MAX_ROWS = 1000;

// Manual "File System" upload for one article at a time — reuses the same
// disk-storage-then-move pipeline lib/storage.ts already provides (see storage.ts's own
// comment on why diskStorage, not memoryStorage). News-sourced articles never go through
// this endpoint; they arrive via the ingest worker built in a later phase.
type UploadFileTypeBucket = 'pdf' | 'docx' | 'txt' | 'csv' | 'xlsx' | 'md' | 'html' | 'image';

const ACCEPTED_MIME_TYPES: Record<string, UploadFileTypeBucket> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/html': 'html',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
};
const ACCEPTED_TYPES_LABEL = 'PDF, DOCX, TXT, CSV, XLSX, Markdown, HTML, JPEG, PNG, GIF, WebP';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureTmpUploadDir().then(
        (dir) => cb(null, dir),
        (err: unknown) => cb(err instanceof Error ? err : new Error(String(err)), ''),
      );
    },
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!(file.mimetype in ACCEPTED_MIME_TYPES)) {
      callback(
        new AppError(
          400,
          'UNSUPPORTED_FILE_TYPE',
          `Unsupported file type: ${file.mimetype}. Accepted: ${ACCEPTED_TYPES_LABEL}.`,
        ),
      );
      return;
    }
    callback(null, true);
  },
});

// multer surfaces its own errors (e.g. LIMIT_FILE_SIZE) as MulterError, not AppError — the
// global errorHandler only special-cases AppError, so convert here.
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      next(new AppError(400, 'UPLOAD_ERROR', err.message));
      return;
    }
    next(err);
  });
}

async function cleanupTempFile(req: Request): Promise<void> {
  if (req.file?.path) {
    await rm(req.file.path, { force: true }).catch(() => undefined);
  }
}

// No canonical upload/metadata-edit validator exists in article.schema.ts (unlike the rest
// of the Article contract) — those two shapes are endpoint-specific request bodies, not
// part of the Article entity itself, so they're defined locally here rather than invented
// into the shared package.
const uploadArticleBodySchema = z
  .object({
    title: z.string().min(1),
    projectId: z.string().refine((value) => mongoose.isValidObjectId(value), {
      message: 'projectId must be a valid id',
    }),
    domain: z.string().min(1).optional(),
    summary: z.string().optional(),
    url: z.string().min(1).optional(),
    publishedAt: z.string().min(1).optional(),
    // Multipart text fields are always strings — comma-separated, same encoding
    // convention as pagination.ts's groupIds/tags query params.
    authors: z.string().optional(),
  })
  .strict();
type UploadArticleBody = z.infer<typeof uploadArticleBodySchema>;

const updateArticleMetadataSchema = z
  .object({
    title: z.string().min(1).optional(),
    summary: z.string().optional(),
    domain: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    authors: z.array(z.string()).optional(),
    publishedAt: z.string().min(1).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });
type UpdateArticleMetadataBody = z.infer<typeof updateArticleMetadataSchema>;

const exportArticlesRequestSchema = z
  .object({
    filters: filterPanelStateSchema,
    format: z.enum(['xlsx', 'csv']).optional(),
  })
  .strict();

function toArticleDTO(article: ArticleDocument): Article {
  return {
    id: asArticleId(article._id.toString()),
    orgId: asOrgId(article.orgId.toString()),
    projectId: asProjectId(article.projectId.toString()),
    title: article.title,
    summary: article.summary,
    body: article.body,
    ...(article.url !== undefined ? { url: article.url } : {}),
    domain: article.domain,
    sourceType: article.sourceType,
    publishedAt: article.publishedAt.toISOString(),
    authors: article.authors,
    taxonomyValues: article.taxonomyValues,
    tagIds: article.tagIds.map((id) => id.toString()),
    assets: article.assets.map((asset) => ({
      kind: asset.kind,
      url: asset.url,
      ...(asset.fileSizeBytes !== undefined ? { fileSizeBytes: asset.fileSizeBytes } : {}),
    })),
    locationHash: article.locationHash,
    hidden: article.hidden,
    hiddenAt: article.hiddenAt ? article.hiddenAt.toISOString() : null,
    hiddenBy: article.hiddenBy ? asUserId(article.hiddenBy.toString()) : null,
    ingestedAt: article.ingestedAt.toISOString(),
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}

// Best-effort: Mongo is the system of record, Elasticsearch a derived read index — a
// transient ES failure here must never undo (or block reporting) a Mongo mutation that
// already committed successfully. The next successful write naturally re-syncs it.
async function reindexArticleDoc(article: ArticleDocument): Promise<void> {
  try {
    await indexArticle(toIndexArticleParams(article));
  } catch (err) {
    logger.error({ err, articleId: article._id.toString() }, 'Failed to sync article to Elasticsearch');
  }
}

// Shared by GET /:id, /:id/download, /:id/preview and PATCH /:id — loads a same-org
// article and enforces the caller's project + hard-filter concept grants exactly like a
// search would, but WITHOUT the `hidden` exclusion search applies by default: "hidden"
// only affects default LIST visibility per the brief, never direct access-by-id. A grant
// failure 404s (not 403) so a caller can't distinguish "doesn't exist" from "exists but
// outside your group's data access" — same reasoning as parseObjectIdParam's malformed-id
// handling below.
async function loadAccessibleArticle(req: Request, permission: Permission): Promise<ArticleDocument> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  const id = parseObjectIdParam(req.params.id, 'Article not found', 'ARTICLE_NOT_FOUND');
  const article = await ArticleModel.findOne({ _id: id, orgId: req.user.orgId });
  if (!article) {
    throw new NotFoundError('Article not found', 'ARTICLE_NOT_FOUND');
  }

  const grants = await resolveArticleSearchGrants(req.user, permission);
  const subject = { projectId: article.projectId.toString(), taxonomyValues: article.taxonomyValues };
  if (!canAccessArticle(subject, grants)) {
    throw new NotFoundError('Article not found', 'ARTICLE_NOT_FOUND');
  }
  return article;
}

// ---------------------------------------------------------------------------
// Streaming assets — download (attachment) / preview (inline)
// ---------------------------------------------------------------------------

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function resolveAssetContentType(asset: IArticleAsset): string {
  const ext = path.extname(asset.url).toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? (asset.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream');
}

// Prefers an explicitly requested `?kind=`, then falls back to the most
// preview/download-worthy kind available (a real file beats a placeholder full_text row).
function pickAsset(article: ArticleDocument, requestedKind: unknown): IArticleAsset | undefined {
  if (typeof requestedKind === 'string') {
    const match = article.assets.find((asset) => asset.kind === requestedKind);
    if (match) return match;
  }
  const priority: ArticleAssetKind[] = ['pdf', 'image', 'full_text'];
  for (const kind of priority) {
    const match = article.assets.find((asset) => asset.kind === kind);
    if (match) return match;
  }
  return undefined;
}

function streamAsset(res: Response, asset: IArticleAsset, disposition: 'attachment' | 'inline'): void {
  const filename = path.basename(asset.url) || 'article-file';
  const asciiName = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  res.setHeader('Content-Type', resolveAssetContentType(asset));
  if (asset.fileSizeBytes !== undefined) {
    res.setHeader('Content-Length', String(asset.fileSizeBytes));
  }
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );

  const stream = createFileReadStream(asset.url);
  stream.on('error', (err) => {
    logger.error({ err, fileKey: asset.url }, 'Failed to stream article asset');
    if (!res.headersSent) {
      res.status(404).json({ success: false, code: 'FILE_NOT_FOUND', message: 'Stored file is missing' });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

// ---------------------------------------------------------------------------
// POST /upload — File System source type only
// ---------------------------------------------------------------------------

articleRouter.post(
  '/upload',
  authenticate,
  uploadRateLimiter,
  orgContext,
  handleUpload,
  // multipart text fields aren't populated on req.body until multer (handleUpload) has run.
  validate({ body: uploadArticleBodySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    if (!req.file) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A file is required');
    }

    const body = req.body as UploadArticleBody;

    // articles:read (not a dedicated write permission — none exists in the Permission
    // catalog; articles:hide is the only elevated article permission per the brief) plus
    // the same project grant a search would enforce: you can only add content to a
    // project your current group can already see.
    const grants = await resolveArticleSearchGrants(req.user, 'articles:read' satisfies Permission);
    if (!grants.projectIds.includes(body.projectId)) {
      await cleanupTempFile(req);
      throw new ForbiddenError('Missing project access for this upload');
    }

    const project = await ProjectModel.findOne({ _id: body.projectId, orgId: req.user.orgId }, { _id: 1 });
    if (!project) {
      await cleanupTempFile(req);
      throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    }

    const fileTypeBucket = ACCEPTED_MIME_TYPES[req.file.mimetype];
    if (!fileTypeBucket) {
      await cleanupTempFile(req);
      throw new AppError(400, 'UNSUPPORTED_FILE_TYPE', `Unsupported file type: ${req.file.mimetype}`);
    }

    // LocationHash rule: identity is derived from file content, not filename/path, so
    // re-uploading the same bytes is recognized as the same article (see the unique
    // {orgId, locationHash} index on Article) and updates that row instead of duplicating it.
    const fileBuffer = await fsReadFile(req.file.path);
    const locationHash = createHash('sha256').update(fileBuffer).digest('hex');

    let article = await ArticleModel.findOne({ orgId: req.user.orgId, locationHash });
    const isNewArticle = !article;
    const authors = body.authors
      ? body.authors
          .split(',')
          .map((author) => author.trim())
          .filter(Boolean)
      : [];
    const publishedAt = body.publishedAt ? new Date(body.publishedAt) : new Date();

    if (!article) {
      article = new ArticleModel({
        orgId: req.user.orgId,
        projectId: body.projectId,
        title: body.title,
        summary: body.summary ?? '',
        body: '',
        ...(body.url ? { url: body.url } : {}),
        domain: body.domain ?? 'Manual Upload',
        sourceType: 'file_system',
        publishedAt,
        authors,
        taxonomyValues: {},
        tagIds: [],
        assets: [],
        locationHash,
        hidden: false,
        ingestedAt: new Date(),
      });
    } else {
      // Re-upload of identical bytes: refresh the caller-editable metadata; leave
      // hidden/tagIds/taxonomyValues exactly as they already were on the existing row.
      article.title = body.title;
      if (body.summary !== undefined) article.summary = body.summary;
      if (body.url) article.url = body.url;
      if (body.domain) article.domain = body.domain;
      article.publishedAt = publishedAt;
      if (authors.length > 0) article.authors = authors;
      article.ingestedAt = new Date();
    }

    const assetKind: ArticleAssetKind =
      fileTypeBucket === 'pdf' ? 'pdf' : fileTypeBucket === 'image' ? 'image' : 'full_text';
    const fileKey = buildFileKey(req.user.orgId, article._id.toString(), req.file.originalname, 1);

    try {
      await moveFileIntoStorage(req.file.path, fileKey);
    } catch (err) {
      await cleanupTempFile(req);
      throw err;
    }

    let extractedText = '';
    if (fileTypeBucket !== 'image') {
      try {
        extractedText = await extractText(fileKey, fileTypeBucket);
      } catch (err) {
        logger.error({ err, fileKey }, 'Failed to extract text for uploaded article');
      }
    }
    article.body = extractedText;
    article.assets = [
      { kind: assetKind, url: fileKey, fileSizeBytes: req.file.size },
      ...article.assets.filter((asset) => asset.kind !== assetKind),
    ];

    await article.save();
    await reindexArticleDoc(article);

    if (isNewArticle) {
      void notifyDynamicChannelsForProject(req.user.orgId, body.projectId).catch((err: unknown) => {
        logger.error({ err, projectId: body.projectId }, 'Failed to notify channels after article upload');
      });
    }

    res.status(isNewArticle ? 201 : 200).json(success(toArticleDTO(article)));
  }),
);

// ---------------------------------------------------------------------------
// Single-article reads
// ---------------------------------------------------------------------------

articleRouter.get(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    const article = await loadAccessibleArticle(req, 'articles:read' satisfies Permission);
    res.status(200).json(success(toArticleDTO(article)));
  }),
);

articleRouter.get(
  '/:id/download',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    const article = await loadAccessibleArticle(req, 'articles:read' satisfies Permission);
    const asset = pickAsset(article, req.query.kind);
    if (!asset) {
      throw new NotFoundError('Article has no stored asset', 'ASSET_NOT_FOUND');
    }
    streamAsset(res, asset, 'attachment');
  }),
);

// Same asset resolution as /download, served inline for in-browser viewing (PDF viewer,
// <img>) instead of forcing a save-as prompt.
articleRouter.get(
  '/:id/preview',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    const article = await loadAccessibleArticle(req, 'articles:read' satisfies Permission);
    const asset = pickAsset(article, req.query.kind);
    if (!asset) {
      throw new NotFoundError('Article has no stored asset', 'ASSET_NOT_FOUND');
    }
    streamAsset(res, asset, 'inline');
  }),
);

// ---------------------------------------------------------------------------
// Notes — private (author only) or group-visible to members who can articles:read
// ---------------------------------------------------------------------------

interface PopulatedNoteAuthor {
  _id: mongoose.Types.ObjectId;
  email: string;
}

type PopulatedArticleNote = Omit<ArticleNoteDocument, 'authorId'> & { authorId: PopulatedNoteAuthor };

const NOTE_AUTHOR_POPULATE = { path: 'authorId', select: 'email' };

function toArticleNoteDTO(note: PopulatedArticleNote): ArticleNote {
  return {
    id: asArticleNoteId(note._id.toString()),
    orgId: asOrgId(note.orgId.toString()),
    articleId: asArticleId(note.articleId.toString()),
    authorId: asUserId(note.authorId._id.toString()),
    authorEmail: note.authorId.email,
    body: note.body,
    visibility: note.visibility,
    ...(note.groupId ? { groupId: asGroupId(note.groupId.toString()) } : {}),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function canSeeGroupNote(scope: { orgWide: boolean; allowedGroupIds: string[] | null }, groupId: string | null | undefined): boolean {
  if (!groupId) return false;
  if (scope.orgWide) return true;
  return Boolean(scope.allowedGroupIds?.includes(groupId));
}

async function loadVisibleNote(
  req: Request,
  article: ArticleDocument,
  noteId: string,
): Promise<PopulatedArticleNote> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  const note = await ArticleNoteModel.findOne({
    _id: noteId,
    orgId: req.user.orgId,
    articleId: article._id,
  }).populate<{ authorId: PopulatedNoteAuthor }>(NOTE_AUTHOR_POPULATE);
  if (!note) {
    throw new NotFoundError('Note not found', 'NOTE_NOT_FOUND');
  }
  const authorId = note.authorId._id.toString();
  if (note.visibility === 'private') {
    if (authorId !== req.user.id) {
      throw new NotFoundError('Note not found', 'NOTE_NOT_FOUND');
    }
    return note;
  }
  const scope = await resolveDocumentScope(req.user, 'articles:read' satisfies Permission);
  if (!canSeeGroupNote(scope, note.groupId?.toString())) {
    throw new NotFoundError('Note not found', 'NOTE_NOT_FOUND');
  }
  return note;
}

articleRouter.get(
  '/:id/notes',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const article = await loadAccessibleArticle(req, 'articles:read' satisfies Permission);
    const scope = await resolveDocumentScope(req.user, 'articles:read' satisfies Permission);
    const notes = await ArticleNoteModel.find({ orgId: req.user.orgId, articleId: article._id })
      .sort({ createdAt: 1 })
      .populate<{ authorId: PopulatedNoteAuthor }>(NOTE_AUTHOR_POPULATE);

    const visible = notes.filter((note) => {
      const authorId = note.authorId._id.toString();
      if (note.visibility === 'private') return authorId === req.user!.id;
      return canSeeGroupNote(scope, note.groupId?.toString());
    });
    res.status(200).json(success(visible.map(toArticleNoteDTO)));
  }),
);

articleRouter.post(
  '/:id/notes',
  authenticate,
  orgContext,
  validate({ body: createArticleNoteSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const article = await loadAccessibleArticle(req, 'articles:read' satisfies Permission);
    const body = req.body as CreateArticleNoteInput;

    let groupId: string | null = null;
    if (body.visibility === 'group') {
      groupId = body.groupId ?? null;
      if (!groupId || !mongoose.isValidObjectId(groupId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'groupId must be a valid id');
      }
      const scope = await resolveDocumentScope(req.user, 'articles:read' satisfies Permission);
      if (!canSeeGroupNote(scope, groupId)) {
        throw new ForbiddenError('Missing required permission: articles:read');
      }
    }

    const created = await ArticleNoteModel.create({
      orgId: req.user.orgId,
      articleId: article._id,
      authorId: req.user.id,
      body: body.body,
      visibility: body.visibility,
      groupId,
    });
    const populated = await created.populate<{ authorId: PopulatedNoteAuthor }>(NOTE_AUTHOR_POPULATE);

    audit(req, {
      action: 'article.note.create',
      entityType: 'article-note',
      entityId: populated._id.toString(),
      groupId,
      details: { articleId: article._id.toString(), visibility: body.visibility },
    });

    res.status(201).json(success(toArticleNoteDTO(populated)));
  }),
);

articleRouter.patch(
  '/:id/notes/:noteId',
  authenticate,
  orgContext,
  validate({ body: updateArticleNoteSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const article = await loadAccessibleArticle(req, 'articles:read' satisfies Permission);
    const noteId = parseObjectIdParam(req.params.noteId, 'Note not found', 'NOTE_NOT_FOUND');
    const note = await loadVisibleNote(req, article, noteId);
    if (note.authorId._id.toString() !== req.user.id) {
      throw new ForbiddenError('Only the author can update this note');
    }

    const body = req.body as UpdateArticleNoteInput;
    const nextVisibility = body.visibility ?? note.visibility;
    let nextGroupId = note.groupId?.toString() ?? null;
    if (body.visibility === 'private') {
      nextGroupId = null;
    } else if (body.visibility === 'group' || (nextVisibility === 'group' && body.groupId)) {
      nextGroupId = body.groupId ?? nextGroupId;
      if (!nextGroupId || !mongoose.isValidObjectId(nextGroupId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'groupId must be a valid id');
      }
      const scope = await resolveDocumentScope(req.user, 'articles:read' satisfies Permission);
      if (!canSeeGroupNote(scope, nextGroupId)) {
        throw new ForbiddenError('Missing required permission: articles:read');
      }
    }

    if (body.body !== undefined) note.body = body.body;
    note.visibility = nextVisibility;
    note.groupId = nextGroupId ? new mongoose.Types.ObjectId(nextGroupId) : null;
    await note.save();
    const populated = await note.populate<{ authorId: PopulatedNoteAuthor }>(NOTE_AUTHOR_POPULATE);

    audit(req, {
      action: 'article.note.update',
      entityType: 'article-note',
      entityId: note._id.toString(),
      groupId: nextGroupId,
      details: { articleId: article._id.toString(), visibility: nextVisibility },
    });

    res.status(200).json(success(toArticleNoteDTO(populated)));
  }),
);

articleRouter.delete(
  '/:id/notes/:noteId',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const article = await loadAccessibleArticle(req, 'articles:read' satisfies Permission);
    const noteId = parseObjectIdParam(req.params.noteId, 'Note not found', 'NOTE_NOT_FOUND');
    const note = await loadVisibleNote(req, article, noteId);
    if (note.authorId._id.toString() !== req.user.id) {
      throw new ForbiddenError('Only the author can delete this note');
    }

    await ArticleNoteModel.deleteOne({ _id: note._id });
    audit(req, {
      action: 'article.note.delete',
      entityType: 'article-note',
      entityId: note._id.toString(),
      groupId: note.groupId?.toString() ?? null,
      details: { articleId: article._id.toString() },
    });
    res.status(200).json(success({ deleted: true }));
  }),
);

// ---------------------------------------------------------------------------
// PATCH /:id — metadata edit
// ---------------------------------------------------------------------------

articleRouter.patch(
  '/:id',
  authenticate,
  orgContext,
  validate({ body: updateArticleMetadataSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as UpdateArticleMetadataBody;
    const article = await loadAccessibleArticle(req, 'articles:read' satisfies Permission);

    if (body.title !== undefined) article.title = body.title;
    if (body.summary !== undefined) article.summary = body.summary;
    if (body.domain !== undefined) article.domain = body.domain;
    if (body.url !== undefined) article.url = body.url;
    if (body.authors !== undefined) article.authors = body.authors;
    if (body.publishedAt !== undefined) article.publishedAt = new Date(body.publishedAt);

    await article.save();
    await reindexArticleDoc(article);

    res.status(200).json(success(toArticleDTO(article)));
  }),
);

// ---------------------------------------------------------------------------
// Hide / unhide — articles:hide, the Application-Admin-grade permission (no system role
// other than Application Admin's '*' wildcard is seeded with it; see permissions.ts).
// ---------------------------------------------------------------------------

articleRouter.post(
  '/:id/hide',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const article = await loadAccessibleArticle(req, 'articles:hide' satisfies Permission);

    if (!article.hidden) {
      article.hidden = true;
      article.hiddenAt = new Date();
      article.hiddenBy = new mongoose.Types.ObjectId(req.user.id);
      await article.save();
      await reindexArticleDoc(article);
    }

    audit(req, {
      action: 'article.hide',
      entityType: 'article',
      entityId: article._id.toString(),
      details: { title: article.title, ...(article.url ? { url: article.url } : {}) },
    });

    res.status(200).json(success(toArticleDTO(article)));
  }),
);

articleRouter.post(
  '/:id/unhide',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    const article = await loadAccessibleArticle(req, 'articles:hide' satisfies Permission);

    if (article.hidden) {
      article.hidden = false;
      article.hiddenAt = null;
      article.hiddenBy = null;
      await article.save();
      await reindexArticleDoc(article);
    }

    audit(req, {
      action: 'article.unhide',
      entityType: 'article',
      entityId: article._id.toString(),
      details: { title: article.title, ...(article.url ? { url: article.url } : {}) },
    });

    res.status(200).json(success(toArticleDTO(article)));
  }),
);

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

const BULK_PERMISSION_BY_ACTION: Record<ArticleBulkAction, Permission> = {
  hide: 'articles:hide',
  unhide: 'articles:hide',
  // addTags/removeTags don't map to one fixed permission the way hide/unhide do —
  // userTag.routes.ts's bulk-apply/bulk-remove (the feature these two actions must stay
  // consistent with) already gates tag USE on the tag's own sharing grants (ownerGroupId +
  // sharedWithGroups[].canUse/canDelete), not a flat permission check. See
  // canUseOrRemoveUserTag below — articles:read is only the baseline "can touch this
  // article at all" gate for these two actions.
  addTags: 'articles:read',
  removeTags: 'articles:read',
};

const BULK_AUDIT_ACTION: Record<ArticleBulkAction, AuditAction> = {
  hide: 'article.hide',
  unhide: 'article.unhide',
  addTags: 'article.tag',
  removeTags: 'article.untag',
};

// Mirrors userTag.routes.ts's (unexported) assertCanUseOrRemoveTag exactly — same
// org-admin bypass, same owner-group-manage bypass, same private-tag share-grant check,
// same public-tag any-group-manage fallback — so a tag's sharing rules can't be
// circumvented just because the request arrived through the Articles bulk endpoint
// instead of /api/user-tags/bulk-apply|bulk-remove.
function canUseOrRemoveUserTag(
  user: AuthenticatedUser,
  effective: EffectivePermissions,
  tag: UserTagDocument,
  mode: 'use' | 'delete',
): boolean {
  if (hasGlobalPermission(user, 'org:admin' satisfies Permission)) return true;
  // A GLOBAL (groupId: null) user-tags:manage grant is a superset of every group-scoped
  // one — check it once up front (same JWT fast-path resolveArticleSearchGrants uses)
  // rather than re-deriving it inside each of the group-scoped checks below.
  const manageAnywhere = (groupId: string) =>
    hasGlobalPermission(user, 'user-tags:manage' satisfies Permission) ||
    hasPermissionInGroup(effective, 'user-tags:manage' satisfies Permission, groupId);

  if (manageAnywhere(tag.ownerGroupId.toString())) return true;

  if (tag.isPrivate) {
    return tag.sharedWithGroups.some((grant) => {
      const grantAllows = mode === 'use' ? grant.canUse : grant.canDelete;
      return grantAllows && manageAnywhere(grant.groupId.toString());
    });
  }
  return (
    hasGlobalPermission(user, 'user-tags:manage' satisfies Permission) ||
    hasPermissionInAnyGroup(effective, 'user-tags:manage' satisfies Permission)
  );
}

articleRouter.post(
  '/bulk',
  authenticate,
  orgContext,
  validate({ body: articleBulkRequestSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const body = req.body as ArticleBulkRequestInput;
    const grants = await resolveArticleSearchGrants(req.user, BULK_PERMISSION_BY_ACTION[body.action]);

    // addTags/removeTags: every referenced tag must independently authorize this caller
    // (checked once per tag, not per article — same granularity as
    // userTag.routes.ts's bulk-apply/bulk-remove) before touching a single article. A
    // missing or unauthorized tag rejects the whole request rather than partially applying.
    if (body.action === 'addTags' || body.action === 'removeTags') {
      const effective = await resolveUserEffectivePermissions(req.user);
      const mode = body.action === 'addTags' ? 'use' : 'delete';
      const requestedTagIds = Array.from(new Set(body.tagIds ?? []));
      const tags = await UserTagModel.find({
        _id: { $in: requestedTagIds.filter((tagId) => mongoose.isValidObjectId(tagId)) },
        orgId: req.user.orgId,
      });
      const tagsById = new Map(tags.map((tag) => [tag._id.toString(), tag]));

      for (const tagId of requestedTagIds) {
        const tag = tagsById.get(tagId);
        if (!tag) {
          throw new NotFoundError('User tag not found', 'USER_TAG_NOT_FOUND');
        }
        if (!canUseOrRemoveUserTag(req.user, effective, tag, mode)) {
          throw new ForbiddenError(`Missing permission to ${mode} tag "${tag.name}"`);
        }
      }
    }

    const uniqueIds = Array.from(new Set(body.articleIds)).filter((id) => mongoose.isValidObjectId(id));
    const articles = await ArticleModel.find({ _id: { $in: uniqueIds }, orgId: req.user.orgId });
    const articlesById = new Map(articles.map((article) => [article._id.toString(), article]));

    // Only hide/unhide need identifiers/URLs surfaced in the audit entry — "Activity log
    // records removals with identifiers/URLs" per the brief; addTags/removeTags just need
    // counts + the tag ids involved.
    const auditedArticles: Array<{ id: string; title: string; url?: string }> = [];
    const results: BulkOperationItemResult[] = [];

    for (const articleId of body.articleIds) {
      const article = articlesById.get(articleId);
      if (!article) {
        results.push({ id: articleId, success: false, error: 'Article not found' });
        continue;
      }

      const subject = { projectId: article.projectId.toString(), taxonomyValues: article.taxonomyValues };
      if (!canAccessArticle(subject, grants)) {
        results.push({ id: articleId, success: false, error: 'Not permitted for this article' });
        continue;
      }

      try {
        switch (body.action) {
          case 'hide': {
            if (!article.hidden) {
              article.hidden = true;
              article.hiddenAt = new Date();
              article.hiddenBy = new mongoose.Types.ObjectId(req.user.id);
              await article.save();
              await reindexArticleDoc(article);
            }
            break;
          }
          case 'unhide': {
            if (article.hidden) {
              article.hidden = false;
              article.hiddenAt = null;
              article.hiddenBy = null;
              await article.save();
              await reindexArticleDoc(article);
            }
            break;
          }
          case 'addTags': {
            const toAdd = (body.tagIds ?? []).filter((tagId) => mongoose.isValidObjectId(tagId));
            const existing = new Set(article.tagIds.map((tagId) => tagId.toString()));
            for (const tagId of toAdd) {
              if (!existing.has(tagId)) {
                article.tagIds.push(new mongoose.Types.ObjectId(tagId));
                existing.add(tagId);
              }
            }
            await article.save();
            await reindexArticleDoc(article);
            break;
          }
          case 'removeTags': {
            const toRemove = new Set(body.tagIds ?? []);
            article.tagIds = article.tagIds.filter((tagId) => !toRemove.has(tagId.toString()));
            await article.save();
            await reindexArticleDoc(article);
            break;
          }
        }
        results.push({ id: articleId, success: true });
        if (body.action === 'hide' || body.action === 'unhide') {
          auditedArticles.push({
            id: article._id.toString(),
            title: article.title,
            ...(article.url ? { url: article.url } : {}),
          });
        }
      } catch (err) {
        results.push({
          id: articleId,
          success: false,
          error: err instanceof Error ? err.message : 'Operation failed',
        });
      }
    }

    const succeeded = results.filter((result) => result.success).length;
    const result: BulkOperationResult = {
      requested: body.articleIds.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };

    audit(req, {
      action: BULK_AUDIT_ACTION[body.action],
      entityType: 'article',
      details: {
        bulkAction: body.action,
        requested: result.requested,
        succeeded,
        failed: result.failed,
        ...(body.tagIds ? { tagIds: body.tagIds } : {}),
        ...(auditedArticles.length > 0 ? { articles: auditedArticles } : {}),
      },
    });

    res.status(200).json(success(result));
  }),
);

// ---------------------------------------------------------------------------
// Export — the current filtered result set as a spreadsheet. POST (not GET) since the
// filter shape (FilterPanelState, including nested Advanced Search groups) doesn't fit
// cleanly in a query string. Gated on export:run specifically (a role can hold
// articles:read without export:run), and reuses lib/search.ts's query builder — no
// bespoke export query logic here.
// ---------------------------------------------------------------------------

articleRouter.post(
  '/export',
  authenticate,
  searchRateLimiter,
  orgContext,
  validate({ body: exportArticlesRequestSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { filters, format } = req.body as { filters: FilterPanelState; format?: 'xlsx' | 'csv' };
    const grants = await resolveArticleSearchGrants(req.user, 'export:run' satisfies Permission);

    const result = await executeArticleSearch({
      filters,
      grants,
      page: 1,
      size: EXPORT_MAX_ROWS,
      orgId: req.user.orgId,
    });

    const rows = result.hits.map((hit) => ({
      title: hit.title,
      domain: hit.domain,
      sourceType: hit.sourceType,
      publishedAt: hit.publishedAt,
      hidden: hit.hidden ? 'Yes' : 'No',
      tags: hit.tagIds.join(', '),
      summary: hit.summary,
    }));

    if (format === 'csv') {
      const header = ['Title', 'Domain', 'Source Type', 'Published At', 'Hidden', 'Tags', 'Summary'];
      const csvRows = rows.map((row) =>
        [row.title, row.domain, row.sourceType, row.publishedAt, row.hidden, row.tags, row.summary]
          .map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
          .join(','),
      );
      const csv = [header.join(','), ...csvRows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="articles-export.csv"');
      res.status(200).send(csv);
      return;
    }

    // exceljs is CJS; default-import + destructure per the same ESM-interop convention as
    // lib/text-extraction.ts's identical xlsx handling.
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Articles');
    sheet.columns = [
      { header: 'Title', key: 'title', width: 50 },
      { header: 'Domain', key: 'domain', width: 24 },
      { header: 'Source Type', key: 'sourceType', width: 14 },
      { header: 'Published At', key: 'publishedAt', width: 22 },
      { header: 'Hidden', key: 'hidden', width: 10 },
      { header: 'Tags', key: 'tags', width: 30 },
      { header: 'Summary', key: 'summary', width: 60 },
    ];
    for (const hit of result.hits) {
      sheet.addRow({
        title: hit.title,
        domain: hit.domain,
        sourceType: hit.sourceType,
        publishedAt: hit.publishedAt,
        hidden: hit.hidden ? 'Yes' : 'No',
        tags: hit.tagIds.join(', '),
        summary: hit.summary,
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="articles-export.xlsx"');
    res.status(200).send(Buffer.from(buffer));
  }),
);
