import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';

import type { ApiResponse, Article } from '@content-insights/shared';

import { apiClient, getApiErrorMessage } from '../lib/api-client';
import { INPUT_CLASSNAME } from '../lib/form-styles';
import { formatDate } from '../lib/format';
import { fetchProjects } from '../lib/projects-api';

// Mirrors article.routes.ts's ACCEPTED_MIME_TYPES/MAX_FILE_SIZE_BYTES exactly — this is the
// File System upload path (POST /api/articles/upload), the only way to manually add an
// Article; sourceType is forced to 'file_system' server-side regardless of what's sent here.
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.csv', '.xlsx', '.md', '.html', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/markdown',
  'text/x-markdown',
  'text/html',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];
const ACCEPTED_TYPES_LABEL = 'PDF, DOCX, TXT, CSV, XLSX, Markdown, HTML, JPEG, PNG, GIF, or WebP';
const MAX_FILE_SIZE_LABEL = '200MB';

function isAllowedFile(file: File): boolean {
  const dotIndex = file.name.lastIndexOf('.');
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : '';
  const extensionOk = ALLOWED_EXTENSIONS.includes(extension);
  // Some browsers/OSes report an empty file.type for recognized extensions —
  // treat that as inconclusive rather than a rejection.
  const mimeOk = file.type === '' || ALLOWED_MIME_TYPES.includes(file.type);
  return extensionOk && mimeOk;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [domain, setDomain] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [url, setUrl] = useState('');
  const [authors, setAuthors] = useState('');
  const [summary, setSummary] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [createdArticle, setCreatedArticle] = useState<Article | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // GET /api/projects is already scoped server-side to what this caller may see (org-wide
  // for projects:read/projects:manage, otherwise the union of their groups'
  // dataAccess.projectIds) — no client-side re-filtering needed, unlike the old
  // group-permission cross-reference this page used to do for Documents.
  const projectsQuery = useQuery({ queryKey: ['projects-options'], queryFn: () => fetchProjects(1), staleTime: 60_000 });
  const projectOptions = projectsQuery.data?.items ?? [];
  const isBlocked = !projectsQuery.isLoading && projectOptions.length === 0;

  function applyFile(selected: File) {
    if (!isAllowedFile(selected)) {
      setFile(null);
      setFileError(`Unsupported file type. Accepted: ${ACCEPTED_TYPES_LABEL}.`);
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
      setFileError(`Unsupported file type. Accepted: ${ACCEPTED_TYPES_LABEL}.`);
      return;
    }
    if (!title.trim()) {
      setUploadError('Title is required.');
      return;
    }
    if (!projectId) {
      setUploadError('Select a project to add this article to.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim());
    formData.append('projectId', projectId);
    if (domain.trim()) formData.append('domain', domain.trim());
    if (summary.trim()) formData.append('summary', summary.trim());
    if (url.trim()) formData.append('url', url.trim());
    if (publishedAt) formData.append('publishedAt', publishedAt);
    if (authors.trim()) formData.append('authors', authors.trim());

    setIsUploading(true);
    setUploadProgress(0);
    try {
      // Called directly through apiClient (not articles-api.ts's uploadArticle helper) so
      // onUploadProgress can drive the progress bar below — the plain helper has no way to
      // observe upload progress.
      const response = await apiClient.post<ApiResponse<Article>>('/articles/upload', formData, {
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
      // POST /articles/upload is fully synchronous — text extraction and Elasticsearch
      // indexing already happened server-side by the time this response arrives, so
      // there's no separate "processing" status to poll (unlike the old Document flow).
      setCreatedArticle(body.data);
    } catch (err) {
      setUploadError(getApiErrorMessage(err, 'Unable to upload the article. Please try again.'));
    } finally {
      setIsUploading(false);
    }
  }

  function resetForAnotherUpload() {
    setCreatedArticle(null);
    setFile(null);
    setTitle('');
    setProjectId('');
    setDomain('');
    setPublishedAt('');
    setUrl('');
    setAuthors('');
    setSummary('');
    setUploadProgress(0);
    setFileError(null);
    setUploadError(null);
  }

  const wordCount = createdArticle?.body ? createdArticle.body.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <Link to="/articles" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          &larr; Back to articles
        </Link>

        <h1 className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">Add an article</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Manually add a File System article from a local file. {ACCEPTED_TYPES_LABEL} files up to{' '}
          {MAX_FILE_SIZE_LABEL} are supported.
        </p>

        {createdArticle === null ? (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-[var(--text-secondary)]">
                Title
              </label>
              <input
                id="title"
                type="text"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={`mt-1 ${INPUT_CLASSNAME}`}
              />
            </div>

            <div>
              <label htmlFor="project" className="block text-sm font-medium text-[var(--text-secondary)]">
                Project
              </label>
              <select
                id="project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                required
                disabled={isBlocked}
                className={`mt-1 ${INPUT_CLASSNAME}`}
              >
                <option value="">Select a project…</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {isBlocked ? (
                <p className="mt-1 text-xs text-[var(--red)]">
                  You do not have access to any project. Ask an admin to grant you project access.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="domain" className="block text-sm font-medium text-[var(--text-secondary)]">
                  Source / domain <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <input
                  id="domain"
                  type="text"
                  placeholder="e.g. nytimes.com"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  className={`mt-1 ${INPUT_CLASSNAME}`}
                />
              </div>
              <div>
                <label htmlFor="publishedAt" className="block text-sm font-medium text-[var(--text-secondary)]">
                  Published date <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <input
                  id="publishedAt"
                  type="date"
                  value={publishedAt}
                  onChange={(event) => setPublishedAt(event.target.value)}
                  className={`mt-1 ${INPUT_CLASSNAME}`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="url" className="block text-sm font-medium text-[var(--text-secondary)]">
                  Source URL <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <input
                  id="url"
                  type="url"
                  placeholder="https://example.com/article"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className={`mt-1 ${INPUT_CLASSNAME}`}
                />
              </div>
              <div>
                <label htmlFor="authors" className="block text-sm font-medium text-[var(--text-secondary)]">
                  Authors <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <input
                  id="authors"
                  type="text"
                  placeholder="Jane Doe, John Smith"
                  value={authors}
                  onChange={(event) => setAuthors(event.target.value)}
                  className={`mt-1 ${INPUT_CLASSNAME}`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="summary" className="block text-sm font-medium text-[var(--text-secondary)]">
                Summary <span className="text-[var(--text-muted)]">(optional)</span>
              </label>
              <textarea
                id="summary"
                rows={3}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                className={`mt-1 ${INPUT_CLASSNAME}`}
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-[var(--text-secondary)]">File</span>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={handleBrowseKeyDown}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`mt-1 cursor-pointer rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  isDraggingOver
                    ? 'border-[var(--accent)] bg-[var(--bg-hover)]'
                    : 'border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)]'
                }`}
              >
                <p className="text-sm text-[var(--text-secondary)]">
                  {file ? file.name : 'Drag and drop a file here, or click to browse'}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {ACCEPTED_TYPES_LABEL} — up to {MAX_FILE_SIZE_LABEL}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_EXTENSIONS.join(',')}
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </div>
              {fileError ? <p className="mt-1 text-sm text-[var(--red)]">{fileError}</p> : null}
            </div>

            {isUploading ? (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-hover)]">
                  <div
                    className="h-full bg-[var(--accent)] transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {uploadProgress < 100 ? `${uploadProgress}%` : 'Processing…'}
                </p>
              </div>
            ) : null}

            {uploadError ? <p className="text-sm text-[var(--red)]">{uploadError}</p> : null}

            <button
              type="submit"
              disabled={isUploading || isBlocked}
              className="w-full rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? 'Uploading…' : 'Add article'}
            </button>
          </form>
        ) : (
          <div className="mt-6 space-y-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--green)' }} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">{createdArticle.title}</p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  {createdArticle.domain} · {formatDate(createdArticle.publishedAt)}
                  {wordCount > 0 ? ` · ${wordCount.toLocaleString()} words` : ''}
                </p>
              </div>
            </div>

            <p className="text-sm" style={{ color: 'var(--green)' }}>
              Article added.
            </p>

            <div className="flex gap-3">
              <Link
                to={`/articles/${createdArticle.id}`}
                className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
              >
                View article
              </Link>
              <button
                type="button"
                onClick={resetForAnotherUpload}
                className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                Add another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
