import { Lock, X } from 'lucide-react';

import type { UserTag } from '@content-insights/shared';

// Sidebar tag browser. `tags` is rendered exactly as given — the GET /user-tags endpoint is
// the privacy enforcement boundary (public tags + private tags from the caller's own groups),
// so this component never re-filters on top of it.
interface TagsPanelProps {
  tags: UserTag[];
  isLoading: boolean;
  onTagClick: (tag: UserTag) => void;
  onClose: () => void;
}

export default function TagsPanel({ tags, isLoading, onTagClick, onClose }: TagsPanelProps) {
  return (
    <aside className="w-80 shrink-0 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tags</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tags panel"
          className="rounded-[6px] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-3 space-y-1">
        {isLoading ? (
          Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-8 animate-shimmer rounded-[var(--radius-button)]" />
          ))
        ) : tags.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">
            No tags yet. Create one from &quot;Tag Selected&quot; after checking an article.
          </p>
        ) : (
          tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => onTagClick(tag)}
              className="flex w-full items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              {tag.isPrivate ? (
                <Lock size={11} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
              ) : (
                <span className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{tag.articleCount}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
