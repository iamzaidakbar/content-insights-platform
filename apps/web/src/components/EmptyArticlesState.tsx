// Simple line-art "empty document stack" — inline SVG (no image asset/dependency),
// strokes use currentColor so it inherits the muted text token automatically.
function EmptyDocumentStackIllustration() {
  return (
    <svg
      width="120"
      height="96"
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="18" y="46" width="64" height="40" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <rect x="28" y="32" width="64" height="40" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.6" />
      <rect x="38" y="18" width="64" height="40" rx="4" fill="var(--bg-card)" stroke="currentColor" strokeWidth="2" />
      <line x1="48" y1="30" x2="82" y2="30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="48" y1="38" x2="92" y2="38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="48" y1="46" x2="76" y2="46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface EmptyArticlesStateProps {
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export default function EmptyArticlesState({ onClearFilters, hasActiveFilters }: EmptyArticlesStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-[var(--text-muted)]">
        <EmptyDocumentStackIllustration />
      </div>
      <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">No articles found</h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Try adjusting your filters.</p>
      {hasActiveFilters ? (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-4 flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--border)] px-4 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
