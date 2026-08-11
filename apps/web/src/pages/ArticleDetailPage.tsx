import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Calendar,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Plus,
  Search,
  Tag as TagIcon,
  Users as UsersIcon,
  X,
} from 'lucide-react';

import type { Article, ArticleAsset, UserTag } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { useClickOutside } from '../hooks/useClickOutside';
import ArticleAssetViewer from '../components/ArticleAssetViewer';
import { getApiErrorMessage } from '../lib/api-client';
import { bulkArticleOperation, downloadArticle, fetchArticle, hideArticle, unhideArticle } from '../lib/articles-api';
import { fetchConcepts } from '../lib/concepts-api';
import { formatDate } from '../lib/format';
import { fetchProject } from '../lib/projects-api';
import { createUserTag, fetchUserTags } from '../lib/user-tags-api';

// Carried by whatever list drilled the caller in here (search results, a channel run,
// a saved search) so the breadcrumb can name where "back" actually goes — router `state`
// for same-app navigations, a `?from=` query param for anything that only has a label to
// give (e.g. a bookmarked/shared link). Falls back to a generic "Articles" crumb pointing
// at /articles when neither is present. Same LocationState-from-router pattern as
// LoginPage/RegisterPage's post-login redirect.
interface ArticleDetailLocationState {
  from?: { label: string; path?: string };
}

const SOURCE_TYPE_LABEL: Record<Article['sourceType'], string> = {
  news: 'News',
  file_system: 'File System',
};

function SectionCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        {icon}
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-[var(--text-secondary)]">{label}</span>
      <span className="min-w-0 truncate text-right text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

// Splits the extracted/ingested body into paragraphs on blank lines — Article.body is plain
// text (not markdown/HTML), so this is the only formatting it needs to read comfortably.
function renderBodyParagraphs(text: string): React.ReactNode[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.split(/\n{2,}/).map((paragraph, index) => (
    <p key={index} className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-[var(--text-primary)] first:mt-0">
      {paragraph.trim()}
    </p>
  ));
}

function filenameForAsset(article: Article, asset: ArticleAsset): string {
  const baseName = article.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'article';
  const dotIndex = asset.url.lastIndexOf('.');
  const extFromUrl = dotIndex >= 0 ? asset.url.slice(dotIndex) : '';
  const fallbackExt = asset.kind === 'pdf' ? '.pdf' : asset.kind === 'image' ? '.jpg' : '.txt';
  return `${baseName}${extFromUrl || fallbackExt}`;
}

// ---------------------------------------------------------------------------
// Add-tag popover — a single-article, color-less variant of TagSelectPopover (UserTag has
// no `color` field, unlike the old Tag model that component was built for, and this only
// ever targets one article, not a bulk selection) — so it's kept local to this page rather
// than shared.
// ---------------------------------------------------------------------------

interface AddTagPopoverProps {
  candidateTags: UserTag[];
  isBusy: boolean;
  onSelectTag: (tag: UserTag) => void;
  onCreateTag: (name: string) => void;
  onClose: () => void;
}

function AddTagPopover({ candidateTags, isBusy, onSelectTag, onCreateTag, onClose }: AddTagPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, onClose);

  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();
  const visibleTags = trimmedQuery
    ? candidateTags.filter((tag) => tag.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : candidateTags;
  const exactMatchExists = candidateTags.some((tag) => tag.name.toLowerCase() === trimmedQuery.toLowerCase());

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full z-20 mt-2 w-64 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-lg"
    >
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search or create a tag…"
          className="h-8 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] pl-8 pr-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
        {visibleTags.length === 0 ? (
          <p className="py-1 text-xs text-[var(--text-muted)]">No matching tags.</p>
        ) : (
          visibleTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              disabled={isBusy}
              onClick={() => onSelectTag(tag)}
              className="flex w-full items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
            </button>
          ))
        )}
      </div>

      {trimmedQuery && !exactMatchExists ? (
        <button
          type="button"
          disabled={isBusy}
          onClick={() => onCreateTag(trimmedQuery)}
          className="mt-2 flex w-full items-center gap-1.5 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm text-[var(--accent)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={14} />
          Create &quot;{trimmedQuery}&quot;
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { permissions } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [isAddTagOpen, setIsAddTagOpen] = useState(false);
  const [pendingHideAction, setPendingHideAction] = useState<'hide' | 'unhide' | null>(null);

  const canHide = permissions.includes('*') || permissions.includes('articles:hide');
  // Coarse client-side gate only — the real per-tag authorization (owner-group manage,
  // an explicit share grant, or org-wide user-tags:manage for a public tag; see
  // article.routes.ts's canUseOrRemoveUserTag) is enforced server-side regardless. A caller
  // who passes this but isn't actually authorized for a specific tag just sees that one
  // add/remove rejected via toast, same graceful-degradation pattern used elsewhere
  // (ArticlesPage's bulk tag mutation).
  const canManageTags = permissions.includes('*') || permissions.includes('user-tags:manage');

  const articleQuery = useQuery({
    queryKey: ['article', id],
    queryFn: () => fetchArticle(id as string),
    enabled: id !== undefined,
  });
  const article = articleQuery.data;

  const conceptsQuery = useQuery({
    queryKey: ['concepts', article?.projectId],
    queryFn: () => fetchConcepts(article?.projectId as string),
    enabled: article !== undefined,
    staleTime: 60_000,
  });

  const projectQuery = useQuery({
    queryKey: ['project', article?.projectId],
    queryFn: () => fetchProject(article?.projectId as string),
    enabled: article !== undefined,
    staleTime: 5 * 60_000,
  });

  // Fetched unconditionally (GET /user-tags never 403s — it just returns whatever subset
  // the caller can see, empty array included) so tag NAMES always resolve for display;
  // only the add/remove affordances below are gated on canManageTags.
  const tagsQuery = useQuery({
    queryKey: ['user-tags'],
    queryFn: fetchUserTags,
    enabled: article !== undefined,
    staleTime: 60_000,
  });

  function invalidateArticle() {
    void queryClient.invalidateQueries({ queryKey: ['article', id] });
  }

  const hideMutation = useMutation({
    mutationFn: (action: 'hide' | 'unhide') => (action === 'hide' ? hideArticle(id as string) : unhideArticle(id as string)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['article', id], updated);
      setPendingHideAction(null);
      toast.success(updated.hidden ? 'Article hidden.' : 'Article unhidden.');
    },
    onError: (err: unknown) => {
      setPendingHideAction(null);
      toast.error(getApiErrorMessage(err, 'Unable to update this article.'));
    },
  });

  const addTagMutation = useMutation({
    mutationFn: (tagId: string) =>
      bulkArticleOperation({ action: 'addTags', articleIds: [id as string], tagIds: [tagId] }),
    onSuccess: (result) => {
      if (result.failed > 0) {
        toast.error(result.results[0]?.error ?? 'Unable to add this tag.');
      } else {
        invalidateArticle();
      }
      setIsAddTagOpen(false);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to add this tag.')),
  });

  const removeTagMutation = useMutation({
    mutationFn: (tagId: string) =>
      bulkArticleOperation({ action: 'removeTags', articleIds: [id as string], tagIds: [tagId] }),
    onSuccess: (result) => {
      if (result.failed > 0) {
        toast.error(result.results[0]?.error ?? 'Unable to remove this tag.');
      } else {
        invalidateArticle();
      }
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to remove this tag.')),
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => createUserTag({ name, isPrivate: false }),
    onSuccess: (tag) => {
      queryClient.setQueryData<UserTag[]>(['user-tags'], (current) => [...(current ?? []), tag]);
      addTagMutation.mutate(tag.id);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to create this tag.')),
  });

  async function handleDownloadAsset(asset: ArticleAsset) {
    if (!article) return;
    try {
      await downloadArticle(article.id, filenameForAsset(article, asset), asset.kind);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Unable to download this file.'));
    }
  }

  if (!id) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <p className="text-sm text-[var(--red)]">Invalid article id.</p>
      </div>
    );
  }

  const state = location.state as ArticleDetailLocationState | null;
  const crumbLabel = state?.from?.label ?? searchParams.get('from') ?? 'Articles';
  const crumbPath = state?.from?.path ?? '/articles';

  if (articleQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="h-4 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="mt-4 h-8 w-1/2 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="mt-6 h-64 animate-pulse rounded-[var(--radius-card)] bg-[var(--bg-hover)]" />
      </div>
    );
  }

  if (articleQuery.isError || !article) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <Link to={crumbPath} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          &larr; Back to {crumbLabel}
        </Link>
        <p className="mt-6 text-sm text-[var(--red)]">
          {getApiErrorMessage(articleQuery.error, 'Article not found or you do not have access to it.')}
        </p>
      </div>
    );
  }

  const assetsByKind = new Map(article.assets.map((asset) => [asset.kind, asset]));
  const pdfAsset = assetsByKind.get('pdf');
  // "download-from-URL": whatever non-PDF asset is on file. For a file_system upload this
  // is the original uploaded file (full_text kind covers everything except pdf/image, per
  // article.routes.ts's fileTypeBucket mapping); for a crawled news article it would be
  // whatever the crawler captured from Article.url (e.g. a hero image). Kept as a distinct
  // action from "Download PDF" per the brief, even though today at most one of the two
  // typically exists on a given article.
  const sourceAsset = assetsByKind.get('full_text') ?? assetsByKind.get('image');
  const hasPreviewableAsset = pdfAsset !== undefined || assetsByKind.get('image') !== undefined;

  // Article.tagIds is deliberately plain string[] (see article.ts), not UserTagId[] — keyed
  // here as <string, UserTag> so a lookup by one of those raw ids type-checks.
  const tagsById = new Map<string, UserTag>((tagsQuery.data ?? []).map((tag) => [tag.id, tag]));
  const articleTags = article.tagIds.map((tagId) => tagsById.get(tagId)).filter((tag): tag is UserTag => Boolean(tag));
  const candidateTags = (tagsQuery.data ?? []).filter((tag) => !article.tagIds.includes(tag.id));

  const concepts = conceptsQuery.data ?? [];
  const conceptByKey = new Map(concepts.map((concept) => [concept.key, concept]));
  const taxonomyEntries = Object.entries(article.taxonomyValues)
    .filter(([, values]) => values.length > 0)
    .sort((a, b) => {
      const orderA = conceptByKey.get(a[0])?.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = conceptByKey.get(b[0])?.order ?? Number.MAX_SAFE_INTEGER;
      return orderA !== orderB ? orderA - orderB : a[0].localeCompare(b[0]);
    });

  const isHideBusy = hideMutation.isPending;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
        <Link to={crumbPath} className="hover:text-[var(--text-primary)]">
          {crumbLabel}
        </Link>
        <ChevronRight size={14} className="shrink-0 text-[var(--text-muted)]" />
        <span className="min-w-0 truncate text-[var(--text-primary)]">{article.title}</span>
      </nav>

      {/* Header */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{article.title}</h1>
            {article.hidden ? (
              <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-[var(--red)]">
                Hidden
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--text-secondary)]">
            {article.url ? (
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[var(--accent)] hover:underline"
              >
                <Globe size={14} className="shrink-0" />
                {article.domain}
              </a>
            ) : (
              <span className="flex items-center gap-1.5">
                <Globe size={14} className="shrink-0" />
                {article.domain}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar size={14} className="shrink-0" />
              {formatDate(article.publishedAt)}
            </span>
            {article.authors.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <UsersIcon size={14} className="shrink-0" />
                {article.authors.join(', ')}
              </span>
            ) : null}
            <span className="rounded-[var(--radius-tag)] bg-[var(--bg-hover)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
              {SOURCE_TYPE_LABEL[article.sourceType]}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {article.url ? (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--border)] px-3 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
            >
              <ExternalLink size={15} />
              Open full article
            </a>
          ) : null}
          {sourceAsset ? (
            <button
              type="button"
              onClick={() => void handleDownloadAsset(sourceAsset)}
              className="flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--border)] px-3 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
            >
              <Download size={15} />
              Download
            </button>
          ) : null}
          {pdfAsset ? (
            <button
              type="button"
              onClick={() => void handleDownloadAsset(pdfAsset)}
              className="flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--border)] px-3 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
            >
              <Download size={15} />
              Download PDF
            </button>
          ) : null}
          {canHide ? (
            <button
              type="button"
              onClick={() => setPendingHideAction(article.hidden ? 'unhide' : 'hide')}
              className={`flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] border px-3 text-sm transition-colors ${
                article.hidden
                  ? 'border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent)]'
                  : 'border-[var(--red)] text-[var(--red)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {article.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
              {article.hidden ? 'Unhide' : 'Hide'}
            </button>
          ) : null}
        </div>
      </div>

      {article.hidden && article.hiddenAt ? (
        <p className="mt-3 rounded-[var(--radius-input)] bg-red-500/10 px-3 py-2 text-sm text-[var(--red)]">
          Hidden {formatDate(article.hiddenAt)} — excluded from default search results and lists, but still
          reachable directly by anyone who can already open this page.
        </p>
      ) : null}

      {/* Original file/image preview — only when there's a native binary asset to show. */}
      {hasPreviewableAsset ? (
        <div className="mt-6">
          <ArticleAssetViewer article={article} onDownload={(asset) => void handleDownloadAsset(asset)} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Full reading content */}
        <div className="lg:col-span-2">
          <SectionCard title="Article">
            {renderBodyParagraphs(article.body) ?? (
              <p className="text-sm text-[var(--text-muted)]">
                No article text is available yet.
                {article.url ? ' Try "Open full article" to read it at the source.' : ''}
              </p>
            )}
          </SectionCard>
        </div>

        {/* Metadata sidebar */}
        <div className="space-y-6">
          <SectionCard title="Details">
            <div className="divide-y divide-[var(--border)]">
              <MetaRow label="Domain" value={article.domain} />
              <MetaRow label="Source type" value={SOURCE_TYPE_LABEL[article.sourceType]} />
              <MetaRow label="Published" value={formatDate(article.publishedAt)} />
              {article.authors.length > 0 ? <MetaRow label="Authors" value={article.authors.join(', ')} /> : null}
              <MetaRow label="Project" value={projectQuery.data?.name ?? '—'} />
              <MetaRow label="Ingested" value={formatDate(article.ingestedAt)} />
            </div>
          </SectionCard>

          <SectionCard title="Taxonomy">
            {taxonomyEntries.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No taxonomy metadata for this article.</p>
            ) : (
              <div className="space-y-3">
                {taxonomyEntries.map(([key, values]) => (
                  <div key={key}>
                    <p className="text-xs text-[var(--text-secondary)]">{conceptByKey.get(key)?.displayLabel ?? key}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {values.map((value) => (
                        <span
                          key={value}
                          className="rounded-[var(--radius-tag)] border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Tags" icon={<TagIcon size={15} className="text-[var(--text-secondary)]" />}>
            <div className="flex flex-wrap items-center gap-1.5">
              {articleTags.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No tags yet.</p>
              ) : (
                articleTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="flex items-center gap-1 rounded-[var(--radius-tag)] px-2 py-1 text-[13px]"
                    style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                  >
                    {tag.name}
                    {canManageTags ? (
                      <button
                        type="button"
                        aria-label={`Remove tag ${tag.name}`}
                        disabled={removeTagMutation.isPending}
                        onClick={() => removeTagMutation.mutate(tag.id)}
                        className="rounded-full hover:opacity-70 disabled:opacity-40"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </span>
                ))
              )}
            </div>

            {canManageTags ? (
              <div className="relative mt-3 inline-block">
                <button
                  type="button"
                  onClick={() => setIsAddTagOpen((open) => !open)}
                  className="flex h-8 items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--border)] px-2.5 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
                >
                  <Plus size={14} />
                  Add tag
                </button>
                {isAddTagOpen ? (
                  <AddTagPopover
                    candidateTags={candidateTags}
                    isBusy={addTagMutation.isPending || createTagMutation.isPending}
                    onSelectTag={(tag) => addTagMutation.mutate(tag.id)}
                    onCreateTag={(name) => createTagMutation.mutate(name)}
                    onClose={() => setIsAddTagOpen(false)}
                  />
                ) : null}
              </div>
            ) : null}
          </SectionCard>
        </div>
      </div>

      {/* Hide/unhide confirmation */}
      {pendingHideAction ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => (isHideBusy ? undefined : setPendingHideAction(null))}
          role="dialog"
          aria-modal="true"
          aria-label={pendingHideAction === 'hide' ? 'Confirm hide' : 'Confirm unhide'}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {pendingHideAction === 'hide' ? 'Hide this article?' : 'Unhide this article?'}
            </h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {pendingHideAction === 'hide'
                ? 'Hidden articles are excluded from default search results and lists, but remain reachable directly by anyone who can already open this page.'
                : 'This article will reappear in default search results and lists.'}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingHideAction(null)}
                disabled={isHideBusy}
                className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => hideMutation.mutate(pendingHideAction)}
                disabled={isHideBusy}
                className={`flex items-center gap-1.5 rounded-[var(--radius-button)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                  pendingHideAction === 'hide' ? 'bg-[var(--red)] hover:opacity-90' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                }`}
              >
                {isHideBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                {pendingHideAction === 'hide' ? 'Hide' : 'Unhide'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
