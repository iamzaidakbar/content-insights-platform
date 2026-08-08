import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import type { ArticleContentType, DateRangeFilter, Tag } from '@content-insights/shared';

import { composeAdvancedSearchQuery, type AdvancedSearchWords } from '../lib/advanced-search';

export interface AdvancedSearchResult {
  query: string;
  dateRange: DateRangeFilter;
  sourceUrlContains: string;
  tags: string[];
  contentType: ArticleContentType | null;
}

interface AdvancedSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (result: AdvancedSearchResult) => void;
  tags: Tag[];
}

const EMPTY_WORDS: AdvancedSearchWords = {
  allWords: '',
  exactPhrase: '',
  anyWords: '',
  noneWords: '',
};

const CONTENT_TYPE_OPTIONS: { value: ArticleContentType; label: string }[] = [
  { value: 'news', label: 'News' },
  { value: 'document', label: 'Document' },
  { value: 'report', label: 'Report' },
];

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 h-9 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

export default function AdvancedSearchModal({ isOpen, onClose, onSearch, tags }: AdvancedSearchModalProps) {
  const [words, setWords] = useState<AdvancedSearchWords>(EMPTY_WORDS);
  const [dateRange, setDateRange] = useState<DateRangeFilter>({});
  const [sourceUrlContains, setSourceUrlContains] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [contentType, setContentType] = useState<ArticleContentType | null>(null);

  useEffect(() => {
    if (isOpen) {
      setWords(EMPTY_WORDS);
      setDateRange({});
      setSourceUrlContains('');
      setSelectedTags([]);
      setContentType(null);
    }
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

  if (!isOpen) {
    return null;
  }

  const composedQuery = composeAdvancedSearchQuery(words);
  // Source URL contains isn't sent to the backend (no url field exists on an indexed
  // chunk to filter against) — it's still required to count toward "is there anything
  // to search for" so the button doesn't stay disabled after only typing into that field.
  const hasAnyInput =
    composedQuery.length > 0 ||
    Boolean(dateRange.start) ||
    Boolean(dateRange.end) ||
    sourceUrlContains.trim().length > 0 ||
    selectedTags.length > 0 ||
    contentType !== null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!hasAnyInput) {
      return;
    }
    onSearch({
      query: composedQuery,
      dateRange,
      sourceUrlContains: sourceUrlContains.trim(),
      tags: selectedTags,
      contentType,
    });
    onClose();
  }

  // Keyed by tag *name* (not id) — see SearchFilters.tags in @content-insights/shared for why.
  function toggleTag(tagName: string) {
    setSelectedTags((current) =>
      current.includes(tagName) ? current.filter((name) => name !== tagName) : [...current, tagName],
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-12"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Advanced Search</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close advanced search"
            className="rounded-[6px] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          <TextField
            label="All of these words"
            value={words.allWords}
            onChange={(value) => setWords((current) => ({ ...current, allWords: value }))}
            placeholder="quarterly report finance"
          />
          <TextField
            label="Exact phrase"
            value={words.exactPhrase}
            onChange={(value) => setWords((current) => ({ ...current, exactPhrase: value }))}
            placeholder="net promoter score"
          />
          <TextField
            label="Any of these words"
            value={words.anyWords}
            onChange={(value) => setWords((current) => ({ ...current, anyWords: value }))}
            placeholder="alpha beta gamma"
          />
          <TextField
            label="None of these words"
            value={words.noneWords}
            onChange={(value) => setWords((current) => ({ ...current, noneWords: value }))}
            placeholder="draft deprecated"
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Date range — from</span>
              <input
                type="date"
                value={dateRange.start ?? ''}
                onChange={(event) =>
                  setDateRange((current) => ({ ...current, start: event.target.value || undefined }))
                }
                className="mt-1 h-9 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Date range — to</span>
              <input
                type="date"
                value={dateRange.end ?? ''}
                onChange={(event) =>
                  setDateRange((current) => ({ ...current, end: event.target.value || undefined }))
                }
                className="mt-1 h-9 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>

          <TextField
            label="Source URL contains"
            value={sourceUrlContains}
            onChange={setSourceUrlContains}
            placeholder="example.com/news"
          />

          <div>
            <span className="text-xs font-medium text-[var(--text-secondary)]">Tags</span>
            <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] p-2">
              {tags.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No tags yet.</p>
              ) : (
                tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag.name)}
                      onChange={() => toggleTag(tag.name)}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                    />
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                    {tag.name}
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-[var(--text-secondary)]">Content type</span>
            <div className="mt-1 flex items-center gap-4">
              {CONTENT_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-secondary)]"
                >
                  <input
                    type="radio"
                    name="advanced-content-type"
                    checked={contentType === option.value}
                    onChange={() => setContentType(option.value)}
                    className="h-4 w-4 border-[var(--border)] accent-[var(--accent)]"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[var(--radius-button)] border border-[var(--border)] px-4 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasAnyInput}
            className="h-9 rounded-[var(--radius-button)] bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Search
          </button>
        </div>
      </div>
    </div>
  );
}
