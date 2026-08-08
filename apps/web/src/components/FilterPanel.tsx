import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

import type { ArticleContentType, SearchFilters, Tag } from '@content-insights/shared';

import { useClickOutside } from '../hooks/useClickOutside';

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  filters: SearchFilters;
  onApply: (filters: SearchFilters) => void;
  onClearAll: () => void;
  projectOptions: string[];
  tags: Tag[];
}

// No `source` or `language` field exists anywhere in the Document/SearchHit schema today
// (nothing in the ingestion pipeline populates either), so these two facets have no real
// data to back them. Both sections stay fully interactive — selections flow into
// filters/URL params/lastUsedFilters exactly like every other section — but neither
// narrows actual search results server-side. Flagged here (and in the task summary) as a
// known gap, not an oversight; Channels/Projects, Tags, and Date Range are all genuinely
// backend-wired.
const SOURCE_OPTIONS = ['Uploaded Files', 'Web Articles', 'Press Releases', 'Social Media'];
const LANGUAGE_OPTIONS = [
  'English',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Arabic',
  'Chinese',
  'Japanese',
];

const CONTENT_TYPE_OPTIONS: { value: ArticleContentType; label: string }[] = [
  { value: 'news', label: 'News' },
  { value: 'document', label: 'Document' },
  { value: 'report', label: 'Report' },
];

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--border)] py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-[var(--text-primary)]"
      >
        {title}
        <ChevronDown
          size={16}
          className={`text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  trailing,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm text-[var(--text-secondary)]">
      <span className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-[var(--border)] accent-[var(--accent)]"
        />
        <span className="truncate">{label}</span>
      </span>
      {trailing}
    </label>
  );
}

function toggleInArray(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function LanguageMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, () => setIsOpen(false));

  const summary = selected.length === 0 ? 'All languages' : `${selected.length} selected`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-9 w-full items-center justify-between rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)]"
      >
        <span>{summary}</span>
        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen ? (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-2 shadow-lg">
          {LANGUAGE_OPTIONS.map((language) => (
            <Checkbox
              key={language}
              checked={selected.includes(language)}
              onChange={() => onChange(toggleInArray(selected, language))}
              label={language}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function FilterPanel({
  isOpen,
  onClose,
  filters,
  onApply,
  onClearAll,
  projectOptions,
  tags,
}: FilterPanelProps) {
  const [draft, setDraft] = useState<SearchFilters>(filters);
  const [tagQuery, setTagQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  // Re-seed the draft from the last-committed filters every time the panel opens, so a
  // close-without-Apply (backdrop click, X, Escape) discards any in-progress edits.
  useEffect(() => {
    if (isOpen) {
      setDraft(filters);
      setTagQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed on the open transition, not on every `filters` identity change while open
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const visibleTags = tagQuery.trim()
    ? tags.filter((tag) => tag.name.toLowerCase().includes(tagQuery.trim().toLowerCase()))
    : tags;

  function handleApply() {
    onApply(draft);
    onClose();
  }

  function handleClearAll() {
    onClearAll();
    onClose();
  }

  return (
    <>
      {isOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Filters"
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 w-80 transform border-r border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Filters</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="rounded-[6px] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4">
            <CollapsibleSection title="Date Range">
              <div className="space-y-2">
                <label className="block text-xs text-[var(--text-secondary)]">
                  Start
                  <input
                    type="date"
                    value={draft.dateRange.start ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        dateRange: { ...current.dateRange, start: event.target.value || undefined },
                      }))
                    }
                    className="mt-1 h-9 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  End
                  <input
                    type="date"
                    value={draft.dateRange.end ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        dateRange: { ...current.dateRange, end: event.target.value || undefined },
                      }))
                    }
                    className="mt-1 h-9 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Source" defaultOpen={false}>
              <div className="space-y-0.5">
                {SOURCE_OPTIONS.map((source) => (
                  <Checkbox
                    key={source}
                    checked={draft.sources.includes(source)}
                    onChange={() =>
                      setDraft((current) => ({ ...current, sources: toggleInArray(current.sources, source) }))
                    }
                    label={source}
                    trailing={<span className="shrink-0 text-xs text-[var(--text-muted)]">—</span>}
                  />
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Content Type" defaultOpen={false}>
              <div className="space-y-1">
                {CONTENT_TYPE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)]"
                  >
                    <input
                      type="radio"
                      name="filter-content-type"
                      checked={draft.contentType === option.value}
                      onChange={() => setDraft((current) => ({ ...current, contentType: option.value }))}
                      className="h-4 w-4 border-[var(--border)] accent-[var(--accent)]"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Tags" defaultOpen={false}>
              <div className="relative mb-2">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                />
                <input
                  type="search"
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  placeholder="Search tags…"
                  className="h-8 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] pl-8 pr-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {visibleTags.length === 0 ? (
                  <p className="py-1 text-xs text-[var(--text-muted)]">No matching tags.</p>
                ) : (
                  visibleTags.map((tag) => (
                    <Checkbox
                      key={tag.id}
                      checked={draft.tags.includes(tag.name)}
                      onChange={() =>
                        setDraft((current) => ({ ...current, tags: toggleInArray(current.tags, tag.name) }))
                      }
                      label={tag.name}
                      trailing={
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: tag.color }}
                            aria-hidden="true"
                          />
                          <span className="text-xs text-[var(--text-muted)]">{tag.count}</span>
                        </span>
                      }
                    />
                  ))
                )}
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Language" defaultOpen={false}>
              <LanguageMultiSelect
                selected={draft.languages}
                onChange={(languages) => setDraft((current) => ({ ...current, languages }))}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Channels/Projects" defaultOpen={false}>
              {projectOptions.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No channels connected yet.</p>
              ) : (
                <div className="space-y-0.5">
                  {projectOptions.map((project) => (
                    <Checkbox
                      key={project}
                      checked={draft.projects.includes(project)}
                      onChange={() =>
                        setDraft((current) => ({ ...current, projects: toggleInArray(current.projects, project) }))
                      }
                      label={project}
                    />
                  ))}
                </div>
              )}
            </CollapsibleSection>
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-3">
            <button
              type="button"
              onClick={handleApply}
              className="h-9 flex-1 rounded-[var(--radius-button)] bg-[var(--accent)] text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="h-9 rounded-[var(--radius-button)] border border-[var(--border)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
            >
              Clear All
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
