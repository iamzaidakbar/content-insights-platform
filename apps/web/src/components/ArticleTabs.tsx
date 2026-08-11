import { SOURCE_TYPE_TABS, type SourceTypeTab } from '@content-insights/shared';

// Re-exported for callers that used to import the page-local `ArticleTabKey` name —
// it's now just an alias for the canonical FilterPanelState.sourceTypeTab type so this
// component and ArticlesPage's filter state can never drift out of sync on the tab values.
export type ArticleTabKey = SourceTypeTab;

interface ArticleTabsProps {
  active: SourceTypeTab;
  onChange: (tab: SourceTypeTab) => void;
}

const TAB_LABELS: Record<SourceTypeTab, string> = {
  all: 'All Articles',
  news: 'News',
  documents: 'Documents',
};

export default function ArticleTabs({ active, onChange }: ArticleTabsProps) {
  return (
    <div className="flex gap-6 border-b border-[var(--border)]" role="tablist">
      {SOURCE_TYPE_TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab)}
            className={`border-b-2 pb-3 text-sm transition-colors ${
              isActive
                ? 'border-[var(--accent)] font-semibold text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        );
      })}
    </div>
  );
}
