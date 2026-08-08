import { useState, type ComponentType } from 'react';
import {
  Calendar,
  Camera,
  Edit,
  Eye,
  Globe,
  Tag as TagIcon,
  Upload,
  X,
} from 'lucide-react';

import type { CardDensity } from '@content-insights/shared';

import { useSettings } from '../settings/SettingsContext';
import { formatDate } from '../lib/format';

export interface ArticleCardProps {
  id: string;
  title: string;
  url?: string;
  source?: string;
  publishDate: string;
  snippet: string;
  tags: string[];
  isSelected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onTag: (id: string) => void;
  onShare: (id: string) => void;
  onBookmark: (id: string) => void;
  onEdit: (id: string) => void;
}

const SNIPPET_LINE_CLAMP: Record<CardDensity, string> = {
  comfortable: 'line-clamp-4',
  compact: 'line-clamp-2',
  cozy: 'line-clamp-3',
};

const MAX_VISIBLE_TAGS: Record<CardDensity, number> = {
  comfortable: 5,
  compact: 2,
  cozy: 3,
};

function ActionIcon({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="group/tip relative">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <Icon size={16} />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100">
        {label}
      </span>
    </div>
  );
}

export default function ArticleCard({
  id,
  title,
  url,
  source,
  publishDate,
  snippet,
  tags,
  isSelected,
  onSelect,
  onTag,
  onShare,
  onBookmark,
  onEdit,
}: ArticleCardProps) {
  const { settings } = useSettings();
  const { cardDensity } = settings.appearance;
  const { openArticleIn } = settings.search;

  const [isHovered, setIsHovered] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const maxTags = MAX_VISIBLE_TAGS[cardDensity];
  const visibleTags = showAllTags ? tags : tags.slice(0, maxTags);
  const overflowCount = tags.length - visibleTags.length;

  function handleViewFullArticle() {
    if (!url) {
      return;
    }
    if (openArticleIn === 'newTab') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else if (openArticleIn === 'sameTab') {
      window.location.href = url;
    } else {
      setIsPreviewOpen(true);
    }
  }

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative rounded-[var(--radius-card)] border p-4 transition-[box-shadow,background-color] duration-150 ${
        isSelected ? 'bg-[var(--accent-soft)]' : 'bg-[var(--bg-card)]'
      } ${isHovered ? 'shadow-[0_4px_20px_rgba(0,0,0,0.3)]' : ''}`}
      style={{
        borderColor: isHovered ? 'var(--accent)' : 'var(--border)',
        borderLeftWidth: '3px',
        borderLeftColor: isSelected || isHovered ? 'var(--accent)' : 'transparent',
      }}
    >
      {/* Top: title + checkbox, source, date */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-base font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(event) => onSelect(id, event.target.checked)}
          aria-label={isSelected ? 'Deselect article' : 'Select article'}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-[var(--border)] accent-[var(--accent)]"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--accent)] hover:underline"
          >
            <Globe size={14} className="shrink-0" />
            <span className="truncate">{source ?? url}</span>
          </a>
        ) : null}
        <div className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
          <Calendar size={14} className="shrink-0" />
          <span>{formatDate(publishDate)}</span>
        </div>
      </div>

      {/* Action icons */}
      <div className="mt-3 flex items-center gap-1">
        <ActionIcon icon={TagIcon} label="Tag" onClick={() => onTag(id)} />
        <ActionIcon icon={Camera} label="Media" onClick={() => onBookmark(id)} />
        <ActionIcon icon={Upload} label="Share" onClick={() => onShare(id)} />
        <ActionIcon icon={Eye} label="Preview" onClick={() => setIsPreviewOpen(true)} />
        <ActionIcon icon={Edit} label="Edit" onClick={() => onEdit(id)} />
      </div>

      {/* Content */}
      <p
        className={`mt-3 text-sm text-[var(--text-secondary)] ${SNIPPET_LINE_CLAMP[cardDensity]}`}
        style={{ lineHeight: 1.6 }}
      >
        {snippet}
      </p>

      {url ? (
        <div className="mt-2 text-right">
          <button
            type="button"
            onClick={handleViewFullArticle}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            View Full Article
          </button>
        </div>
      ) : null}

      {/* Tags */}
      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="rounded-[var(--radius-tag)] px-2 py-1 text-[13px]"
              style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
            >
              {tag}
            </span>
          ))}
          {!showAllTags && overflowCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllTags(true)}
              className="text-[13px] text-[var(--accent)] hover:underline"
            >
              View More ({overflowCount})
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Minimal in-place preview for openArticleIn: 'sidePanel' — a full slide-out reader
          isn't part of this component's scope; this gives a working, self-contained
          preview without requiring a parent-managed panel. */}
      {isPreviewOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 px-4"
          onClick={() => setIsPreviewOpen(false)}
        >
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-surface)] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                aria-label="Close preview"
                className="shrink-0 rounded-[6px] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <X size={18} />
              </button>
            </div>
            {source ? (
              <p className="mt-1 text-sm text-[var(--accent)]">{source}</p>
            ) : null}
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{formatDate(publishDate)}</p>
            <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">{snippet}</p>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline"
              >
                Open original source
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
