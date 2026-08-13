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

import { Alert, Breadcrumbs, Button, Card, CardBody, Input, PageBody, PageHeader, Select, Textarea } from '../components/ui';
import { apiClient, getApiErrorMessage } from '../lib/api-client';
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
    <PageBody>
      <PageHeader
        title="Add an article"
        description={`Manually add a File System article from a local file. ${ACCEPTED_TYPES_LABEL} files up to ${MAX_FILE_SIZE_LABEL} are supported.`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Articles', to: '/articles' },
              { label: 'Upload' },
            ]}
          />
        }
      />

      {createdArticle === null ? (
        <Card>
          <CardBody className="p-5 sm:p-6">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-muted-foreground">
                  Title
                </label>
                <Input
                  id="title"
                  type="text"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <label htmlFor="project" className="block text-sm font-medium text-muted-foreground">
                  Project
                </label>
                <Select
                  id="project"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  required
                  disabled={isBlocked}
                  className="mt-1"
                >
                  <option value="">Select a project…</option>
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
                {isBlocked ? (
                  <p className="mt-1 text-xs text-destructive">
                    You do not have access to any project. Ask an admin to grant you project access.
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="domain" className="block text-sm font-medium text-muted-foreground">
                    Source / domain <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="domain"
                    type="text"
                    placeholder="e.g. nytimes.com"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label htmlFor="publishedAt" className="block text-sm font-medium text-muted-foreground">
                    Published date <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="publishedAt"
                    type="date"
                    value={publishedAt}
                    onChange={(event) => setPublishedAt(event.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="url" className="block text-sm font-medium text-muted-foreground">
                    Source URL <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://example.com/article"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label htmlFor="authors" className="block text-sm font-medium text-muted-foreground">
                    Authors <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="authors"
                    type="text"
                    placeholder="Jane Doe, John Smith"
                    value={authors}
                    onChange={(event) => setAuthors(event.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="summary" className="block text-sm font-medium text-muted-foreground">
                  Summary <span className="text-muted-foreground">(optional)</span>
                </label>
                <Textarea
                  id="summary"
                  rows={3}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-muted-foreground">File</span>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={handleBrowseKeyDown}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`mt-1 cursor-pointer rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                    isDraggingOver
                      ? 'border-primary bg-accent'
                      : 'border-border bg-card hover:border-primary'
                  }`}
                >
                  <p className="text-sm text-muted-foreground">
                    {file ? file.name : 'Drag and drop a file here, or click to browse'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
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
                {fileError ? <p className="mt-1 text-sm text-destructive">{fileError}</p> : null}
              </div>

              {isUploading ? (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-accent">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {uploadProgress < 100 ? `${uploadProgress}%` : 'Processing…'}
                  </p>
                </div>
              ) : null}

              {uploadError ? (
                <Alert variant="error">{uploadError}</Alert>
              ) : null}

              <Button type="submit" className="w-full" disabled={isBlocked} loading={isUploading}>
                {isUploading ? 'Uploading…' : 'Add article'}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="space-y-4 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-success" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{createdArticle.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {createdArticle.domain} · {formatDate(createdArticle.publishedAt)}
                  {wordCount > 0 ? ` · ${wordCount.toLocaleString()} words` : ''}
                </p>
              </div>
            </div>

            <p className="text-sm text-success">Article added.</p>

            <div className="flex flex-wrap gap-3">
              <Link
                to={`/articles/${createdArticle.id}`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                View article
              </Link>
              <Button type="button" variant="outline" onClick={resetForAnotherUpload}>
                Add another
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </PageBody>
  );
}
