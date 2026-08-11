import { SOURCE_TYPE_TABS, type SourceTypeTab } from '@content-insights/shared';

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
    <div className="flex gap-4 border-b border-[var(--border)]" role="tablist">
      {SOURCE_TYPE_TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab)}
            className={`-mb-px border-b-2 pb-2 text-sm transition-colors ${
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
