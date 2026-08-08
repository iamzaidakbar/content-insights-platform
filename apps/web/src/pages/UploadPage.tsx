import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import type { ApiResponse, Document } from '@content-insights/shared';

import { apiClient, getApiErrorMessage } from '../lib/api-client';
import { fetchDocument } from '../lib/documents-api';
import StatusBadge from '../components/StatusBadge';

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

function isAllowedFile(file: File): boolean {
  const dotIndex = file.name.lastIndexOf('.');
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : '';
  const extensionOk = ALLOWED_EXTENSIONS.includes(extension);
  // Some browsers/OSes report an empty file.type for recognized extensions —
  // treat that as inconclusive rather than a rejection.
  const mimeOk = file.type === '' || ALLOWED_MIME_TYPES.includes(file.type);
  return extensionOk && mimeOk;
}

function getMetadataError(metadata: Record<string, unknown>): string | null {
  const value = metadata['error'];
  return typeof value === 'string' ? value : null;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const documentQuery = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => {
      if (!documentId) {
        throw new Error('No document to poll.');
      }
      return fetchDocument(documentId);
    },
    enabled: documentId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'indexed' || status === 'failed' ? false : 3000;
    },
  });

  function applyFile(selected: File) {
    if (!isAllowedFile(selected)) {
      setFile(null);
      setFileError('Only PDF, DOCX, or TXT files are supported.');
      return;
    }
    setFileError(null);
    setFile(selected);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) {
      applyFile(dropped);
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (selected) {
      applyFile(selected);
    }
    // Reset so re-selecting the same file still fires a change event.
    event.target.value = '';
  }

  function handleBrowseKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);

    if (!file) {
      setFileError('Select a file to upload.');
      return;
    }
    if (!isAllowedFile(file)) {
      setFileError('Only PDF, DOCX, or TXT files are supported.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    if (projectId.trim()) {
      formData.append('projectId', projectId.trim());
    }

    setIsUploading(true);
    setUploadProgress(0);
    try {
      const response = await apiClient.post<ApiResponse<Document>>('/documents/upload', formData, {
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total;
          if (total) {
            setUploadProgress(Math.round((progressEvent.loaded / total) * 100));
          }
        },
      });
      const body = response.data;
      if (!body.success) {
        throw new Error(body.message);
      }
      // Seed the poll query with the document we just got back, so the status
      // panel renders immediately instead of flashing empty on the first poll.
      queryClient.setQueryData(['document', body.data.id], body.data);
      setDocumentId(body.data.id);
    } catch (err) {
      setUploadError(getApiErrorMessage(err, 'Unable to upload the document. Please try again.'));
    } finally {
      setIsUploading(false);
    }
  }

  function resetForAnotherUpload() {
    setDocumentId(null);
    setFile(null);
    setTitle('');
    setProjectId('');
    setUploadProgress(0);
    setFileError(null);
    setUploadError(null);
  }

  const status = documentQuery.data?.status;
  const metadataError = documentQuery.data ? getMetadataError(documentQuery.data.metadata) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
      <div className="w-full max-w-xl">
        <Link to="/documents" className="text-sm text-slate-400 underline">
          &larr; Back to documents
        </Link>

        <h1 className="mt-4 text-2xl font-semibold">Upload a document</h1>
        <p className="mt-1 text-sm text-slate-400">
          PDF, DOCX, or TXT files are indexed automatically after upload.
        </p>

        {documentId === null ? (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-slate-300">
                Title
              </label>
              <input
                id="title"
                type="text"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
              />
            </div>

            <div>
              <label htmlFor="projectId" className="block text-sm font-medium text-slate-300">
                Project ID <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="projectId"
                type="text"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-slate-300">File</span>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={handleBrowseKeyDown}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`mt-1 cursor-pointer rounded-md border-2 border-dashed px-6 py-10 text-center transition ${
                  isDraggingOver
                    ? 'border-slate-400 bg-slate-900'
                    : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <p className="text-sm text-slate-300">
                  {file ? file.name : 'Drag and drop a file here, or click to browse'}
                </p>
                <p className="mt-1 text-xs text-slate-500">PDF, DOCX, or TXT</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </div>
              {fileError ? <p className="mt-1 text-sm text-red-400">{fileError}</p> : null}
            </div>

            {isUploading ? (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-slate-100 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">{uploadProgress}%</p>
              </div>
            ) : null}

            {uploadError ? <p className="text-sm text-red-400">{uploadError}</p> : null}

            <button
              type="submit"
              disabled={isUploading}
              className="w-full rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? 'Uploading…' : 'Upload'}
            </button>
          </form>
        ) : (
          <div className="mt-6 space-y-4 rounded-md border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium text-slate-100">
                {documentQuery.data?.title ?? title}
              </p>
              <StatusBadge status={status ?? 'pending'} />
            </div>

            {status === 'indexed' ? (
              <div>
                <p className="text-sm text-emerald-400">Document indexed.</p>
                <div className="mt-4 flex gap-3">
                  <Link
                    to="/documents"
                    className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
                  >
                    View documents
                  </Link>
                  <button
                    type="button"
                    onClick={resetForAnotherUpload}
                    className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-100 transition hover:border-slate-500"
                  >
                    Upload another
                  </button>
                </div>
              </div>
            ) : status === 'failed' ? (
              <div>
                <p className="text-sm text-red-400">
                  {metadataError ?? 'Indexing failed for this document.'}
                </p>
                <div className="mt-4 flex gap-3">
                  <Link
                    to="/documents"
                    className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-100 transition hover:border-slate-500"
                  >
                    Back to documents
                  </Link>
                  <button
                    type="button"
                    onClick={resetForAnotherUpload}
                    className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Indexing your document…</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
