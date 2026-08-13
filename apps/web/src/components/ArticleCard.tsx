import { useState, type CSSProperties, type ComponentType, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  FileDown,
  FileText,
  Globe,
  Layers,
  Maximize2,
  Tag as TagIcon,
} from 'lucide-react';

import type { Concept, ResultViewMode, SearchHit, UserTag } from '@content-insights/shared';

import { fetchArticle, downloadArticle } from '../lib/articles-api';
import { formatDate } from '../lib/format';
import { cn } from '../lib/cn';
import ArticlePreviewModal from './ArticlePreviewModal';
import HighlightedSnippet from './HighlightedSnippet';
import { Button } from './ui/button';
import Tooltip from './ui/tooltip';
import Badge from './ui/badge';

export interface ArticleCardProps {
  hit: SearchHit;
  viewMode: ResultViewMode;
  /** UserSettings.cardContentLines, already resolved for the current project (falls back to 'default'). */
  contentLines: number;
  isSelected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  concepts: Concept[];
  tagsById: Map<string, UserTag>;
  canHide: boolean;
  isHidePending: boolean;
  onHideToggle: (id: string, hidden: boolean) => void;
  onOpenTagPicker: (id: string) => void;
  onTaxonomyValueClick: (conceptKey: string, value: string) => void;
  onTagChipClick: (tagId: string) => void;
}

const MAX_VISIBLE_TAGS = 3;

function clampStyle(lines: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
  };
}

function ActionTip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip content={label}>{children}</Tooltip>;
}

function CardActionButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  active = false,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={15} strokeWidth={1.75} />
    </Button>
  );
}

function TaxonomyRow({
  taxonomyValues,
  concepts,
  onValueClick,
}: {
  taxonomyValues: Record<string, string[]>;
  concepts: Concept[];
  onValueClick: (conceptKey: string, value: string) => void;
}) {
  const entries = Object.entries(taxonomyValues).filter(([, values]) => values.length > 0);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {entries.slice(0, 3).map(([conceptKey, values]) => {
        const label = concepts.find((concept) => concept.key === conceptKey)?.displayLabel ?? conceptKey;
        return (
          <div key={conceptKey} className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Layers size={10} className="shrink-0" />
            <span className="font-medium text-muted-foreground">{label}:</span>
            <span className="truncate">
              {values.slice(0, 2).map((value, index) => (
                <span key={value}>
                  {index > 0 ? ', ' : null}
                  <button
                    type="button"
                    onClick={() => onValueClick(conceptKey, value)}
                    className="hover:text-primary hover:underline"
                  >
                    {value}
                  </button>
                </span>
              ))}
              {values.length > 2 ? ` +${values.length - 2}` : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TagChipsRow({
  tagIds,
  tagsById,
  onTagClick,
}: {
  tagIds: string[];
  tagsById: Map<string, UserTag>;
  onTagClick: (tagId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const resolved = tagIds
    .map((id) => ({ id, tag: tagsById.get(id) }))
    .filter((entry): entry is { id: string; tag: UserTag } => entry.tag !== undefined);

  if (resolved.length === 0) {
    return null;
  }

  const visible = showAll ? resolved : resolved.slice(0, MAX_VISIBLE_TAGS);
  const overflow = resolved.length - visible.length;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {visible.map(({ id, tag }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTagClick(id)}
          title={`Filter by "${tag.name}"`}
          className="rounded-sm bg-muted px-1.5 py-px text-xs font-medium text-foreground transition-opacity hover:opacity-80"
        >
          {tag.name}
        </button>
      ))}
      {!showAll && overflow > 0 ? (
        <button type="button" onClick={() => setShowAll(true)} className="text-xs text-primary hover:underline">
          +{overflow}
        </button>
      ) : null}
      {showAll && resolved.length > MAX_VISIBLE_TAGS ? (
        <button type="button" onClick={() => setShowAll(false)} className="text-xs text-primary hover:underline">
          Less
        </button>
      ) : null}
    </div>
  );
}

export default function ArticleCard({
  hit,
  viewMode,
  contentLines,
  isSelected,
  onSelect,
  isExpanded,
  onToggleExpand,
  concepts,
  tagsById,
  canHide,
  isHidePending,
  onHideToggle,
  onOpenTagPicker,
  onTaxonomyValueClick,
  onTagChipClick,
}: ArticleCardProps) {
  const isList = viewMode === 'list';
  const snippetLines = isList ? Math.min(contentLines, 1) : Math.min(contentLines, 2);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['article-detail', hit.articleId],
    queryFn: () => fetchArticle(hit.articleId),
    enabled: isExpanded,
    staleTime: 5 * 60_000,
  });
  const detail = detailQuery.data;

  const actions = (
    <div className="flex items-center gap-0.5">
      <ActionTip label="Tag">
        <CardActionButton icon={TagIcon} label="Tag" onClick={() => onOpenTagPicker(hit.articleId)} />
      </ActionTip>
      {canHide ? (
        <ActionTip label={hit.hidden ? 'Unhide' : 'Hide'}>
          <CardActionButton
            icon={hit.hidden ? Eye : EyeOff}
            label={hit.hidden ? 'Unhide' : 'Hide'}
            onClick={() => onHideToggle(hit.articleId, hit.hidden)}
            disabled={isHidePending}
          />
        </ActionTip>
      ) : null}
      <ActionTip label="Preview">
        <CardActionButton icon={Maximize2} label="Preview" onClick={() => setIsPreviewOpen(true)} />
      </ActionTip>
      <ActionTip label={isExpanded ? 'Collapse' : 'Expand'}>
        <CardActionButton
          icon={isExpanded ? ChevronUp : ChevronDown}
          label={isExpanded ? 'Collapse' : 'Expand'}
          onClick={() => onToggleExpand(hit.articleId)}
          active={isExpanded}
        />
      </ActionTip>
    </div>
  );

  const meta = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1">
        <Globe size={11} className="shrink-0" />
        <span className="truncate">{hit.domain}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Calendar size={11} className="shrink-0" />
        {formatDate(hit.publishedAt)}
      </span>
    </div>
  );

  const snippet = (
    <div className={isList ? 'mt-1' : 'mt-1.5'}>
      {!isExpanded ? (
        <p
          className="text-xs leading-relaxed text-muted-foreground"
          style={clampStyle(snippetLines)}
        >
          {hit.highlight ? <HighlightedSnippet fragment={hit.highlight} /> : hit.summary || 'No summary available.'}
        </p>
      ) : detailQuery.isLoading ? (
        <div className="space-y-1.5">
          {[0, 1, 2].map((line) => (
            <div key={line} className="h-3 w-full animate-shimmer rounded last:w-2/3" />
          ))}
        </div>
      ) : detailQuery.isError ? (
        <p className="text-xs text-destructive">Unable to load the full article content.</p>
      ) : (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {detail?.body.trim() || hit.summary || 'No content available for this article.'}
        </p>
      )}
    </div>
  );

  const expandedLinks =
    isExpanded && detail ? (
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {detail.url ? (
          <a
            href={detail.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink size={12} /> Open full article
          </a>
        ) : null}
        {detail.assets.some((asset) => asset.kind === 'full_text') ? (
          <button
            type="button"
            onClick={() => void downloadArticle(hit.articleId, `${hit.title}.txt`, 'full_text')}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <FileDown size={12} /> Download text
          </button>
        ) : null}
        {detail.assets.some((asset) => asset.kind === 'pdf') ? (
          <button
            type="button"
            onClick={() => void downloadArticle(hit.articleId, `${hit.title}.pdf`, 'pdf')}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <FileText size={12} /> Download PDF
          </button>
        ) : null}
      </div>
    ) : null;

  const preview = isPreviewOpen ? (
    <ArticlePreviewModal articleId={hit.articleId} onClose={() => setIsPreviewOpen(false)} />
  ) : null;

  if (isList) {
    return (
      <>
        {preview}
      <div
        className={cn(
          'rounded-lg border transition-colors hover:border-border',
          isSelected
            ? 'border-primary bg-accent'
            : 'border-border bg-card',
        )}
        data-testid="article-card"
        data-article-id={hit.articleId}
      >
        <div className="flex items-start gap-2.5 px-3 py-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event) => onSelect(hit.articleId, event.target.checked)}
            aria-label={isSelected ? 'Deselect article' : 'Select article'}
            className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-primary"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => onToggleExpand(hit.articleId)}
                data-testid="article-card-title"
                className="min-w-0 flex-1 truncate text-left text-sm font-medium leading-5 text-foreground hover:text-primary"
              >
                {hit.title}
              </button>
              {hit.hidden ? (
                <Badge variant="warning" className="shrink-0">
                  Hidden
                </Badge>
              ) : null}
              {actions}
            </div>
            <div className="mt-0.5">{meta}</div>
            {(isExpanded || Object.keys(hit.taxonomyValues).length > 0) && (
              <TaxonomyRow
                taxonomyValues={hit.taxonomyValues}
                concepts={concepts}
                onValueClick={onTaxonomyValueClick}
              />
            )}
            {snippet}
            {expandedLinks}
            <TagChipsRow tagIds={hit.tagIds} tagsById={tagsById} onTagClick={onTagChipClick} />
          </div>
        </div>
      </div>
      </>
    );
  }

  // Grid card — equal-height tiles with compact chrome
  return (
    <>
      {preview}
    <div
      className={cn(
        'group flex h-full flex-col rounded-lg border transition-colors hover:border-border hover:shadow-sm',
        isSelected
          ? 'border-primary bg-accent shadow-sm'
          : 'border-border bg-card',
      )}
      data-testid="article-card"
      data-article-id={hit.articleId}
    >
      <div className="flex min-h-0 flex-1 flex-col p-3 pb-2">
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event) => onSelect(hit.articleId, event.target.checked)}
            aria-label={isSelected ? 'Deselect article' : 'Select article'}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-primary"
          />
          <button
            type="button"
            onClick={() => onToggleExpand(hit.articleId)}
            data-testid="article-card-title"
            className="min-w-0 flex-1 text-left text-sm font-semibold leading-snug text-foreground hover:text-primary"
            style={clampStyle(2)}
          >
            {hit.title}
          </button>
          {hit.hidden ? (
            <Badge variant="warning" className="shrink-0">
              Hidden
            </Badge>
          ) : null}
        </div>

        <div className="mt-1.5" style={{ paddingLeft: '1.375rem' }}>
          {meta}
          {snippet}
          {expandedLinks}
          <TagChipsRow tagIds={hit.tagIds} tagsById={tagsById} onTagClick={onTagChipClick} />
          {isExpanded ? (
            <TaxonomyRow
              taxonomyValues={hit.taxonomyValues}
              concepts={concepts}
              onValueClick={onTaxonomyValueClick}
            />
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        {actions}
        <button
          type="button"
          onClick={() => onToggleExpand(hit.articleId)}
          className="text-xs font-medium text-primary opacity-0 transition-opacity hover:underline group-hover:opacity-100 focus:opacity-100"
        >
          {isExpanded ? 'Collapse' : 'Read more'}
        </button>
      </div>
    </div>
    </>
  );
}
