import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Calendar,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Plus,
  Search,
  Tag as TagIcon,
  Users as UsersIcon,
  X,
} from 'lucide-react';

import type { Article, ArticleAsset, UserTag } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { useClickOutside } from '../hooks/useClickOutside';
import ArticleAssetViewer, { pickPreviewAsset } from '../components/ArticleAssetViewer';
import ArticleNotesPanel from '../components/ArticleNotesPanel';
import Alert from '../components/ui/alert';
import Badge from '../components/ui/badge';
import Breadcrumbs from '../components/ui/Breadcrumbs';
import Button from '../components/ui/button';
import { Card, CardBody, CardTitle } from '../components/ui/card';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Input } from '../components/ui/input';
import PageHeader, { PageBody } from '../components/ui/PageHeader';
import Skeleton from '../components/ui/skeleton';
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
    <Card>
      <CardBody className="p-4">
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <div className="mt-3">{children}</div>
      </CardBody>
    </Card>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{value}</span>
    </div>
  );
}

// Splits the extracted/ingested body into paragraphs on blank lines — Article.body is plain
// text (not markdown/HTML), so this is the only formatting it needs to read comfortably.
function renderBodyParagraphs(text: string): React.ReactNode[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.split(/\n{2,}/).map((paragraph, index) => (
    <p key={index} className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground first:mt-0">
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
      className="absolute left-0 top-full z-20 mt-2 w-64 rounded-md border border-border bg-card p-3 shadow-lg"
    >
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search or create a tag…"
          className="h-8 py-1.5 pl-8 pr-2"
        />
      </div>

      <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
        {visibleTags.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">No matching tags.</p>
        ) : (
          visibleTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              disabled={isBusy}
              onClick={() => onSelectTag(tag)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
          className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
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
      <PageBody>
        <Alert variant="error">Invalid article id.</Alert>
      </PageBody>
    );
  }

  const state = location.state as ArticleDetailLocationState | null;
  const crumbLabel = state?.from?.label ?? searchParams.get('from') ?? 'Articles';
  const crumbPath = state?.from?.path ?? '/articles';

  if (articleQuery.isLoading) {
    return (
      <PageBody>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-8 w-1/2" />
        <Skeleton className="mt-5 h-64 w-full" />
      </PageBody>
    );
  }

  if (articleQuery.isError || !article) {
    return (
      <PageBody>
        <PageHeader
          breadcrumbs={<Breadcrumbs items={[{ label: crumbLabel, to: crumbPath }, { label: 'Article' }]} />}
          title="Article unavailable"
        />
        <Alert variant="error">
          {getApiErrorMessage(articleQuery.error, 'Article not found or you do not have access to it.')}
        </Alert>
      </PageBody>
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
  const hasPreviewableAsset = pickPreviewAsset(article.assets) !== undefined;

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
    <PageBody>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: crumbLabel, to: crumbPath },
              { label: article.title },
            ]}
          />
        }
        title={article.title}
        actions={
          <>
            {article.hidden ? <Badge variant="error">Hidden</Badge> : null}
            {article.url ? (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<ExternalLink size={15} />}
                onClick={() => window.open(article.url!, '_blank', 'noopener,noreferrer')}
              >
                Open full article
              </Button>
            ) : null}
            {sourceAsset ? (
              <Button variant="outline" size="sm" leftIcon={<Download size={15} />} onClick={() => void handleDownloadAsset(sourceAsset)}>
                Download
              </Button>
            ) : null}
            {pdfAsset ? (
              <Button variant="outline" size="sm" leftIcon={<Download size={15} />} onClick={() => void handleDownloadAsset(pdfAsset)}>
                Download PDF
              </Button>
            ) : null}
            {canHide ? (
              <Button
                variant={article.hidden ? 'outline' : 'destructive'}
                size="sm"
                leftIcon={article.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                onClick={() => setPendingHideAction(article.hidden ? 'unhide' : 'hide')}
              >
                {article.hidden ? 'Unhide' : 'Hide'}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        {article.url ? (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-primary hover:underline"
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
        <Badge variant="default">{SOURCE_TYPE_LABEL[article.sourceType]}</Badge>
      </div>

      {article.hidden && article.hiddenAt ? (
        <Alert variant="warning" className="mb-4">
          Hidden {formatDate(article.hiddenAt)} — excluded from default search results and lists, but still reachable
          directly by anyone who can already open this page.
        </Alert>
      ) : null}

      {hasPreviewableAsset ? (
        <div className="mb-5">
          <ArticleAssetViewer article={article} onDownload={(asset) => void handleDownloadAsset(asset)} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title="Article">
            {renderBodyParagraphs(article.body) ?? (
              <p className="text-sm text-muted-foreground">
                No article text is available yet.
                {article.url ? ' Try "Open full article" to read it at the source.' : ''}
              </p>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Details">
            <div className="divide-y divide-border">
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
              <p className="text-sm text-muted-foreground">No taxonomy metadata for this article.</p>
            ) : (
              <div className="space-y-3">
                {taxonomyEntries.map(([key, values]) => (
                  <div key={key}>
                    <p className="text-xs text-muted-foreground">{conceptByKey.get(key)?.displayLabel ?? key}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {values.map((value) => (
                        <Badge key={value} variant="default">
                          {value}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Tags" icon={<TagIcon size={15} className="text-muted-foreground" />}>
            <div className="flex flex-wrap items-center gap-1.5">
              {articleTags.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tags yet.</p>
              ) : (
                articleTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="flex items-center gap-1 rounded-sm px-2 py-1 text-[13px]"
                    style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
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
                <Button variant="outline" size="sm" leftIcon={<Plus size={14} />} onClick={() => setIsAddTagOpen((open) => !open)}>
                  Add tag
                </Button>
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

      <div className="mt-4">
        <ArticleNotesPanel articleId={article.id} />
      </div>

      <ConfirmDialog
        open={pendingHideAction !== null}
        onClose={() => {
          if (!isHideBusy) setPendingHideAction(null);
        }}
        onConfirm={() => {
          if (pendingHideAction) hideMutation.mutate(pendingHideAction);
        }}
        title={pendingHideAction === 'hide' ? 'Hide this article?' : 'Unhide this article?'}
        description={
          pendingHideAction === 'hide'
            ? 'Hidden articles are excluded from default search results and lists, but remain reachable directly by anyone who can already open this page.'
            : 'This article will reappear in default search results and lists.'
        }
        confirmLabel={pendingHideAction === 'hide' ? 'Hide' : 'Unhide'}
        destructive={pendingHideAction === 'hide'}
        loading={isHideBusy}
      />
    </PageBody>
  );
}
