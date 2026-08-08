import { useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';

import type { Tag } from '@content-insights/shared';

import { useClickOutside } from '../hooks/useClickOutside';
import { TAG_COLOR_PRESETS } from '../lib/tag-colors';

interface TagSelectPopoverProps {
  tags: Tag[];
  selectedCount: number;
  isCreating: boolean;
  onSelectTag: (tag: Tag) => void;
  onCreateTag: (input: { name: string; color: string }) => void;
  onClose: () => void;
}

export default function TagSelectPopover({
  tags,
  selectedCount,
  isCreating,
  onSelectTag,
  onCreateTag,
  onClose,
}: TagSelectPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, onClose);

  const [query, setQuery] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLOR_PRESETS[0] as string);

  const visibleTags = query.trim()
    ? tags.filter((tag) => tag.name.toLowerCase().includes(query.trim().toLowerCase()))
    : tags;

  function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    const name = newTagName.trim();
    if (!name) {
      return;
    }
    onCreateTag({ name, color: newTagColor });
  }

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-20 mt-2 w-72 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-lg"
    >
      <p className="text-xs text-[var(--text-secondary)]">
        Tag {selectedCount} selected article{selectedCount === 1 ? '' : 's'}
      </p>

      {!isCreatingNew ? (
        <>
          <div className="relative mt-2">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
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
                  onClick={() => onSelectTag(tag)}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsCreatingNew(true)}
            className="mt-2 flex w-full items-center gap-1.5 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm text-[var(--accent)] hover:bg-[var(--bg-hover)]"
          >
            <Plus size={14} />
            Create new tag
          </button>
        </>
      ) : (
        <form onSubmit={handleCreateSubmit} className="mt-2 space-y-2">
          <input
            type="text"
            autoFocus
            value={newTagName}
            onChange={(event) => setNewTagName(event.target.value)}
            placeholder="Tag name"
            maxLength={50}
            className="h-8 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex items-center gap-1.5">
            {TAG_COLOR_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setNewTagColor(color)}
                aria-label={`Color ${color}`}
                className="h-5 w-5 shrink-0 rounded-full ring-offset-1 ring-offset-[var(--bg-surface)]"
                style={{
                  backgroundColor: color,
                  boxShadow: color === newTagColor ? '0 0 0 2px var(--accent)' : undefined,
                }}
              />
            ))}
          </div>
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
              {isCreating ? 'Creating…' : 'Create & Apply'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
