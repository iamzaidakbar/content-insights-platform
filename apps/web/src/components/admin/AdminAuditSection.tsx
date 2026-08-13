import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditEntityType,
  type AuditLogEntry,
} from '@content-insights/shared';

import Pagination from '../Pagination';
import { getApiErrorMessage } from '../../lib/api-client';
import { fetchAuditLog, exportAuditLog } from '../../lib/audit-api';
import { fetchProjects } from '../../lib/projects-api';
import { formatDate } from '../../lib/format';
import Alert from '../ui/alert';
import Button from '../ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '../ui/card';
import { Input, Select } from '../ui/input';
import Skeleton from '../ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../ui/data-table';

// Matches AuditEntityType (packages/shared/src/types/audit.ts) exactly — the pre-pivot
// list here ('document', 'incident') no longer exists on that union at all.
const ENTITY_TYPES: AuditEntityType[] = [
  'article',
  'project',
  'concept',
  'group',
  'role',
  'user',
  'organization',
  'saved-search',
  'user-tag',
  'insight',
  'dashboard',
  'entity-mapping',
  'search',
  'article-note',
];

const PAGE_SIZE = 25;
const MAX_VISIBLE_ARTICLES = 3;

// -----------------------------------------------------------------------------------------
// Details rendering — `details` is a free-form Record<string, unknown> (never full
// payloads/secrets, per AuditLogEntry's own doc comment), so a generic renderer just shows
// each key: value pair compactly. article.hide/article.unhide get a dedicated renderer that
// extracts the captured article title(s)/url(s) instead — both the single-article shape
// ({ title, url? }, from article.routes.ts's POST /:id/hide|unhide) and the bulk shape
// ({ bulkAction, requested, succeeded, failed, articles?: [{id,title,url?}] }, from POST
// /articles/bulk) need to render as readable identifiers, not a raw JSON dump.
// -----------------------------------------------------------------------------------------

interface AuditedArticleRef {
  id?: string;
  title: string;
  url?: string;
}

function isAuditedArticleRef(value: unknown): value is AuditedArticleRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { title?: unknown }).title === 'string'
  );
}

function ArticleRefLine({ article }: { article: AuditedArticleRef }) {
  if (article.url) {
    return (
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
        title={article.url}
      >
        <span className="truncate">{article.title}</span>
        <ExternalLink size={11} className="shrink-0" />
      </a>
    );
  }
  return <span className="truncate">{article.title}</span>;
}

function ArticleAuditDetails({ details }: { details: Record<string, unknown> }) {
  const [showAll, setShowAll] = useState(false);

  const isBulk = typeof details.bulkAction === 'string';

  if (isBulk) {
    const articles = Array.isArray(details.articles) ? details.articles.filter(isAuditedArticleRef) : [];
    const requested = typeof details.requested === 'number' ? details.requested : articles.length;
    const succeeded = typeof details.succeeded === 'number' ? details.succeeded : undefined;
    const failed = typeof details.failed === 'number' ? details.failed : undefined;
    const visible = showAll ? articles : articles.slice(0, MAX_VISIBLE_ARTICLES);
    const overflow = articles.length - visible.length;

    return (
      <div className="max-w-xs">
        <p className="text-xs text-muted-foreground">
          {requested} article{requested === 1 ? '' : 's'} requested
          {typeof succeeded === 'number' ? ` · ${succeeded} succeeded` : ''}
          {typeof failed === 'number' && failed > 0 ? ` · ${failed} failed` : ''}
        </p>
        {visible.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-xs">
            {visible.map((article, index) => (
              <li key={article.id ?? index} className="min-w-0">
                <ArticleRefLine article={article} />
              </li>
            ))}
          </ul>
        ) : null}
        {overflow > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-0.5 text-xs text-primary hover:underline"
          >
            +{overflow} more
          </button>
        ) : null}
      </div>
    );
  }

  // Single-article hide/unhide: { title, url? }
  if (typeof details.title === 'string') {
    return (
      <div className="max-w-xs text-xs">
        <ArticleRefLine article={{ title: details.title, ...(typeof details.url === 'string' ? { url: details.url } : {}) }} />
      </div>
    );
  }

  return <span className="text-xs text-muted-foreground">—</span>;
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map((item) => formatDetailValue(item)).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function GenericAuditDetails({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="max-w-xs space-y-0.5 text-xs text-muted-foreground">
      {entries.map(([key, value]) => (
        <div key={key} className="truncate" title={`${key}: ${formatDetailValue(value)}`}>
          <span className="text-muted-foreground">{key}:</span> {formatDetailValue(value)}
        </div>
      ))}
    </div>
  );
}

function AuditDetailsCell({ entry }: { entry: AuditLogEntry }): ReactNode {
  if (entry.action === 'article.hide' || entry.action === 'article.unhide') {
    return <ArticleAuditDetails details={entry.details} />;
  }
  return <GenericAuditDetails details={entry.details} />;
}

export default function AdminAuditSection() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<AuditAction | ''>('');
  const [entityType, setEntityType] = useState<AuditEntityType | ''>('');
  const [projectId, setProjectId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actorId, setActorId] = useState('');
  const [entityId, setEntityId] = useState('');

  const projectsQuery = useQuery({ queryKey: ['projects-options'], queryFn: () => fetchProjects(1), staleTime: 5 * 60_000 });
  const projects = projectsQuery.data?.items ?? [];
  const projectNameById = new Map(projects.map((project) => [project.id as string, project.name]));

  const from = fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined;
  const to = toDate ? new Date(`${toDate}T23:59:59.999`).toISOString() : undefined;

  const auditQuery = useQuery({
    queryKey: ['audit-log', page, action, entityType, projectId, from, to, actorId, entityId],
    queryFn: () =>
      fetchAuditLog({
        page,
        pageSize: PAGE_SIZE,
        ...(action ? { action } : {}),
        ...(entityType ? { entityType } : {}),
        ...(projectId ? { projectId } : {}),
        ...(actorId ? { actorId } : {}),
        ...(entityId ? { entityId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
  });

  const items = auditQuery.data?.items ?? [];
  const totalPages = auditQuery.data?.totalPages ?? 1;

  const exportMutation = useMutation({
    mutationFn: () =>
      exportAuditLog({
        ...(action ? { action } : {}),
        ...(entityType ? { entityType } : {}),
        ...(projectId ? { projectId } : {}),
        ...(actorId ? { actorId } : {}),
        ...(entityId ? { entityId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
    onSuccess: () => toast.success('Audit export started — check your downloads.'),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Audit export failed.')),
  });

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <Card className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-4">
      <CardHeader className="shrink-0 px-4">
        <CardTitle className="text-base">Audit log</CardTitle>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Immutable record of authentication, article, and admin activity — who did what, when, and (for article
          hide/unhide) exactly which articles.
        </p>
      </CardHeader>
      <CardBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4">
        <div className="flex shrink-0 flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Action
            <Select
              value={action}
              onChange={(e) => resetToFirstPage(setAction)(e.target.value as AuditAction | '')}
              aria-label="Filter by action"
              className="w-auto min-w-[10rem] py-1.5"
            >
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Entity type
            <Select
              value={entityType}
              onChange={(e) => resetToFirstPage(setEntityType)(e.target.value as AuditEntityType | '')}
              aria-label="Filter by entity type"
              className="w-auto min-w-[10rem] py-1.5"
            >
              <option value="">All entity types</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Project
            <Select
              value={projectId}
              onChange={(e) => resetToFirstPage(setProjectId)(e.target.value)}
              aria-label="Filter by project"
              className="w-auto min-w-[10rem] py-1.5"
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Actor id
            <Input
              value={actorId}
              onChange={(e) => resetToFirstPage(setActorId)(e.target.value)}
              aria-label="Filter by actor id"
              placeholder="User id"
              className="w-40 py-1.5"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Entity id
            <Input
              value={entityId}
              onChange={(e) => resetToFirstPage(setEntityId)(e.target.value)}
              aria-label="Filter by entity id"
              placeholder="Entity id"
              className="w-40 py-1.5"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => resetToFirstPage(setFromDate)(e.target.value)}
              aria-label="Filter from date"
              className="w-auto py-1.5"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <Input
              type="date"
              value={toDate}
              onChange={(e) => resetToFirstPage(setToDate)(e.target.value)}
              aria-label="Filter to date"
              className="w-auto py-1.5"
            />
          </label>

          {action || entityType || projectId || fromDate || toDate || actorId || entityId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setAction('');
                setEntityType('');
                setProjectId('');
                setFromDate('');
                setToDate('');
                setActorId('');
                setEntityId('');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<Download size={14} />}
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>

        {auditQuery.isLoading ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : auditQuery.isError ? (
          <Alert variant="error" className="shrink-0">
            {getApiErrorMessage(auditQuery.error, 'Unable to load the audit log.')}
          </Alert>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No audit entries match these filters.</p>
        ) : (
          <>
            <Table scrollable>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Date</TH>
                  <TH>Account</TH>
                  <TH>Project</TH>
                  <TH>Activity</TH>
                  <TH>Details</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((entry) => (
                  <TR key={entry.id} className="align-top">
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(entry.createdAt)}</TD>
                    <TD>{entry.actorEmail}</TD>
                    <TD className="text-muted-foreground">
                      {entry.projectId ? (projectNameById.get(entry.projectId) ?? `${entry.projectId.slice(0, 8)}…`) : '—'}
                    </TD>
                    <TD>
                      <span className="font-mono text-xs text-foreground">{entry.action}</span>
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {entry.entityType}
                      </span>
                    </TD>
                    <TD>
                      <AuditDetailsCell entry={entry} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex shrink-0 justify-end">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </>
        )}
      </CardBody>
    </Card>
    </section>
  );
}
