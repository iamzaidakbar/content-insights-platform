import { useState, type ComponentType, type CSSProperties } from 'react';
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
  Tag as TagIcon,
} from 'lucide-react';

import type { Concept, ResultViewMode, SearchHit, UserTag } from '@content-insights/shared';

import { fetchArticle, downloadArticle } from '../lib/articles-api';
import { formatDate } from '../lib/format';
import HighlightedSnippet from './HighlightedSnippet';

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

const MAX_VISIBLE_TAGS = 4;

function clampStyle(lines: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
  };
}

function ActionIconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <div className="group/tip relative">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={`flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          active
            ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        <Icon size={15} />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100">
        {label}
      </span>
    </div>
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
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
      {entries.map(([conceptKey, values]) => {
        const label = concepts.find((concept) => concept.key === conceptKey)?.displayLabel ?? conceptKey;
        return (
          <div key={conceptKey} className="flex min-w-0 items-center gap-1 text-xs text-[var(--text-secondary)]">
            <Layers size={12} className="shrink-0 text-[var(--text-muted)]" />
            <span className="font-medium">{label}:</span>
            <span className="flex flex-wrap items-center gap-x-1">
              {values.map((value, index) => (
                <span key={value}>
                  {index > 0 ? <span className="text-[var(--text-muted)]">, </span> : null}
                  <button
                    type="button"
                    onClick={() => onValueClick(conceptKey, value)}
                    className="hover:text-[var(--accent)] hover:underline"
                  >
                    {value}
                  </button>
                </span>
              ))}
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
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {visible.map(({ id, tag }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTagClick(id)}
          title={`Filter by "${tag.name}"`}
          className="rounded-[var(--radius-tag)] px-2 py-0.5 text-xs transition-opacity hover:opacity-75"
          style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
        >
          {tag.name}
        </button>
      ))}
      {!showAll && overflow > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs text-[var(--accent)] hover:underline"
        >
          +{overflow} more
        </button>
      ) : null}
      {showAll && resolved.length > MAX_VISIBLE_TAGS ? (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="text-xs text-[var(--accent)] hover:underline"
        >
          Show less
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

  // Full Article detail (body, url, assets, authors) — deliberately NOT fetched for every
  // visible card: SearchHit (packages/shared/src/types/search-result.ts) is a lean search
  // projection with no url/assets/body, by design, so paging through 50 list-view results
  // never has to pull that much data per row. It's only fetched once the user actually
  // expands a card, which is also exactly when "open source / download text / download PDF"
  // become meaningful.
  const detailQuery = useQuery({
    queryKey: ['article-detail', hit.articleId],
    queryFn: () => fetchArticle(hit.articleId),
    enabled: isExpanded,
    staleTime: 5 * 60_000,
  });
  const detail = detailQuery.data;

  const containerClassName = `rounded-[var(--radius-card)] border transition-colors ${
    isSelected ? 'bg-[var(--accent-soft)]' : 'bg-[var(--bg-card)]'
  }`;
  const containerStyle: CSSProperties = {
    borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
  };

  return (
    <div
      className={containerClassName}
      style={containerStyle}
      data-testid="article-card"
      data-article-id={hit.articleId}
    >
      <div className={`flex items-start gap-3 ${isList ? 'p-3' : 'p-4'}`}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(event) => onSelect(hit.articleId, event.target.checked)}
          aria-label={isSelected ? 'Deselect article' : 'Select article'}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-[var(--border)] accent-[var(--accent)]"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => onToggleExpand(hit.articleId)}
              data-testid="article-card-title"
              className={`min-w-0 flex-1 text-left font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] ${
                isList ? 'text-sm' : 'text-base'
              }`}
            >
              {hit.title}
            </button>
            {hit.hidden ? (
              <span
                className="shrink-0 rounded-[var(--radius-tag)] px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--amber)' }}
              >
                Hidden
              </span>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
            <span className="flex min-w-0 items-center gap-1.5">
              <Globe size={13} className="shrink-0" />
              <span className="truncate">{hit.domain}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar size={13} className="shrink-0" />
              {formatDate(hit.publishedAt)}
            </span>
          </div>

          <TaxonomyRow taxonomyValues={hit.taxonomyValues} concepts={concepts} onValueClick={onTaxonomyValueClick} />

          <div className="mt-2">
            {!isExpanded ? (
              <p className="text-sm text-[var(--text-secondary)]" style={{ ...clampStyle(contentLines), lineHeight: 1.6 }}>
                {hit.highlight ? <HighlightedSnippet fragment={hit.highlight} /> : hit.summary || 'No summary available.'}
              </p>
            ) : detailQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((line) => (
                  <div key={line} className="h-3.5 w-full animate-shimmer rounded last:w-2/3" />
                ))}
              </div>
            ) : detailQuery.isError ? (
              <p className="text-sm text-[var(--red)]">Unable to load the full article content.</p>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]" style={{ lineHeight: 1.6 }}>
                {detail?.body.trim() || hit.summary || 'No content available for this article.'}
              </p>
            )}
          </div>

          {isExpanded && detail ? (
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              {detail.url ? (
                <a
                  href={detail.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[var(--accent)] hover:underline"
                >
                  <ExternalLink size={14} /> Open full article
                </a>
              ) : null}
              {detail.assets.some((asset) => asset.kind === 'full_text') ? (
                <button
                  type="button"
                  onClick={() => void downloadArticle(hit.articleId, `${hit.title}.txt`, 'full_text')}
                  className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <FileDown size={14} /> Download from URL
                </button>
              ) : null}
              {detail.assets.some((asset) => asset.kind === 'pdf') ? (
                <button
                  type="button"
                  onClick={() => void downloadArticle(hit.articleId, `${hit.title}.pdf`, 'pdf')}
                  className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <FileText size={14} /> Download PDF
                </button>
              ) : null}
            </div>
          ) : null}

          <TagChipsRow tagIds={hit.tagIds} tagsById={tagsById} onTagClick={onTagChipClick} />

          <div className="mt-2 flex items-center gap-1">
            <ActionIconButton icon={TagIcon} label="Tag" onClick={() => onOpenTagPicker(hit.articleId)} />
            {canHide ? (
              <ActionIconButton
                icon={hit.hidden ? Eye : EyeOff}
                label={hit.hidden ? 'Unhide' : 'Hide'}
                onClick={() => onHideToggle(hit.articleId, hit.hidden)}
                disabled={isHidePending}
              />
            ) : null}
            <ActionIconButton
              icon={isExpanded ? ChevronUp : ChevronDown}
              label={isExpanded ? 'Collapse' : 'Expand'}
              onClick={() => onToggleExpand(hit.articleId)}
              active={isExpanded}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
