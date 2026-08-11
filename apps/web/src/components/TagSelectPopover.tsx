import { useRef, useState, type FormEvent } from 'react';
import { Lock, Plus, Search } from 'lucide-react';

import { USER_TAG_NAME_MAX_LENGTH, type UserTag } from '@content-insights/shared';

import { useClickOutside } from '../hooks/useClickOutside';

// Reusable tag picker — used by the Articles bulk-tag action and the Article detail page's
// tag editor. `tags` is rendered exactly as given: the GET /user-tags endpoint is the privacy
// enforcement boundary (public tags + private tags from the caller's own groups — see
// userTag.routes.ts's own comment), so this component adds no client-side filtering on top of
// whatever list it's handed.
interface TagSelectPopoverProps {
  tags: UserTag[];
  /** Present for a bulk (multi-article) context — pluralizes the header. Omit for a
   *  single-article picker (e.g. Article detail's "add tag" popover). */
  selectedCount?: number;
  /** Disables tag buttons while a select/apply mutation is in flight. */
  isSelecting?: boolean;
  /** Disables the create form's submit while a create mutation is in flight. */
  isCreating?: boolean;
  /** Hides "Create new tag" — e.g. a remove-tag variant that should only offer existing tags. */
  allowCreate?: boolean;
  onSelectTag: (tag: UserTag) => void;
  onCreateTag: (name: string) => void;
  onClose: () => void;
}

export default function TagSelectPopover({
  tags,
  selectedCount,
  isSelecting = false,
  isCreating = false,
  allowCreate = true,
  onSelectTag,
  onCreateTag,
  onClose,
}: TagSelectPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, onClose);

  const [query, setQuery] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const trimmedQuery = query.trim();
  const visibleTags = trimmedQuery
    ? tags.filter((tag) => tag.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : tags;

  function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    const name = newTagName.trim();
    if (!name) {
      return;
    }
    onCreateTag(name);
  }

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-md)]"
    >
      <p className="text-xs text-[var(--text-secondary)]">
        {selectedCount === undefined
          ? 'Select a tag'
          : `Tag ${selectedCount} selected article${selectedCount === 1 ? '' : 's'}`}
      </p>

      {!isCreatingNew ? (
        <>
          <div className="relative mt-2">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tags…"
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
                  disabled={isSelecting}
                  onClick={() => onSelectTag(tag)}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {tag.isPrivate ? (
                    <Lock size={11} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="shrink-0 text-xs text-[var(--text-muted)]">{tag.articleCount}</span>
                </button>
              ))
            )}
          </div>

          {allowCreate ? (
            <button
              type="button"
              onClick={() => setIsCreatingNew(true)}
              className="mt-2 flex w-full items-center gap-1.5 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm text-[var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              <Plus size={14} />
              Create new tag
            </button>
          ) : null}
        </>
      ) : (
        <form onSubmit={handleCreateSubmit} className="mt-2 space-y-1.5">
          <input
            type="text"
            autoFocus
            value={newTagName}
            onChange={(event) => setNewTagName(event.target.value)}
            placeholder="Tag name"
            maxLength={USER_TAG_NAME_MAX_LENGTH}
            className="h-8 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <p className="text-right text-[10px] text-[var(--text-muted)]">
            {newTagName.length}/{USER_TAG_NAME_MAX_LENGTH}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCreatingNew(false)}
              className="h-8 flex-1 rounded-[var(--radius-button)] border border-[var(--border)] text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={!newTagName.trim() || isCreating}
              className="h-8 flex-1 rounded-[var(--radius-button)] bg-[var(--accent)] text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isCreating ? 'Creating…' : 'Create & apply'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
