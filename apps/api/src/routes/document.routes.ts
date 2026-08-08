import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import {
  uploadDocumentSchema,
  type Document,
  type DocumentFileType,
  type PaginatedResult,
  type Permission,
  type UploadDocumentInput,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { pageQuerySchema, type PageQuery } from '../lib/pagination.js';
import { documentIngestQueue } from '../lib/queue.js';
import { success } from '../lib/response.js';
import { toDocumentDTO } from '../lib/serializers.js';
import { buildFileKey, saveFile } from '../lib/storage.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { DocumentModel } from '../models/document.model.js';

export const documentRouter = express.Router();

const PAGE_SIZE = 20;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const ACCEPTED_MIME_TYPES: Record<string, DocumentFileType> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
};

// memoryStorage (not diskStorage): the final disk path needs the real Mongo _id,
// which doesn't exist until the route handler creates the row.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!(file.mimetype in ACCEPTED_MIME_TYPES)) {
      callback(
        new AppError(
          400,
          'UNSUPPORTED_FILE_TYPE',
          `Unsupported file type: ${file.mimetype}. Accepted: PDF, DOCX, TXT.`,
        ),
      );
      return;
    }
    callback(null, true);
  },
});

// multer surfaces its own errors (e.g. LIMIT_FILE_SIZE) as MulterError, not AppError —
// the global errorHandler only special-cases AppError, so convert here.
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

documentRouter.post(
  '/upload',
  authenticate,
  orgContext,
  requirePermission('documents:write' satisfies Permission),
  handleUpload,
  // multipart text fields aren't populated on req.body until multer (handleUpload) has
  // run, so this can't be validated any earlier in the chain.
  validate({ body: uploadDocumentSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    if (!req.file) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A file is required');
    }

    const { title, projectId } = req.body as UploadDocumentInput;

    const fileType = ACCEPTED_MIME_TYPES[req.file.mimetype];
    if (!fileType) {
      throw new AppError(
        400,
        'UNSUPPORTED_FILE_TYPE',
        `Unsupported file type: ${req.file.mimetype}`,
      );
    }

    const doc = await DocumentModel.create({
      orgId: req.user.orgId,
      createdBy: req.user.id,
      ...(projectId !== undefined ? { projectId } : {}),
      title,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileType,
      fileSizeBytes: req.file.size,
      fileKey: '',
      status: 'pending',
      metadata: {},
    });

    const fileKey = buildFileKey(req.user.orgId, doc._id.toString(), req.file.originalname);
    doc.fileKey = fileKey;

    try {
      await saveFile(fileKey, req.file.buffer);
      await doc.save();
      await documentIngestQueue.add('ingest', { documentId: doc._id.toString() });
    } catch (err) {
      // The DB row already exists — don't leave it stuck at 'pending' forever with no backing file.
      doc.status = 'failed';
      doc.metadata = {
        ...doc.metadata,
        error: err instanceof Error ? err.message : 'Failed to store uploaded file',
      };
      await doc.save();
      throw err;
    }

    res.status(201).json(success(toDocumentDTO(doc)));
  }),
);

documentRouter.get(
  '/projects',
  authenticate,
  orgContext,
  requirePermission('documents:read' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    // No Project entity exists anywhere — projectId is a free-form optional string on
    // Document. This exists only so the frontend's project multi-select has data.
    const projectIds = await DocumentModel.distinct('projectId', {
      orgId: req.user.orgId,
      projectId: { $ne: null },
    });

    res.status(200).json(success(projectIds as string[]));
  }),
);

documentRouter.get(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('documents:read' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Document not found', 'DOCUMENT_NOT_FOUND');

    // Scoped to the caller's org in the query itself — a wrong-org id 404s (not 403s),
    // so cross-tenant existence is never confirmed.
    const doc = await DocumentModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!doc) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }

    res.status(200).json(success(toDocumentDTO(doc)));
  }),
);

documentRouter.get(
  '/',
  authenticate,
  orgContext,
  requirePermission('documents:read' satisfies Permission),
  validate({ query: pageQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { page = 1 } = req.query as unknown as PageQuery;

    const [items, total] = await Promise.all([
      DocumentModel.find({ orgId: req.user.orgId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE),
      DocumentModel.countDocuments({ orgId: req.user.orgId }),
    ]);

    const result: PaginatedResult<Document> = {
      items: items.map(toDocumentDTO),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };

    res.status(200).json(success(result));
  }),
);
