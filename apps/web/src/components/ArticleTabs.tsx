export type ArticleTabKey = 'all' | 'news' | 'documents';

interface ArticleTabsProps {
  active: ArticleTabKey;
  onChange: (tab: ArticleTabKey) => void;
}

const TABS: { key: ArticleTabKey; label: string }[] = [
  { key: 'all', label: 'All Articles' },
  { key: 'news', label: 'News' },
  { key: 'documents', label: 'Documents' },
];

export default function ArticleTabs({ active, onChange }: ArticleTabsProps) {
  return (
    <div className="flex gap-6 border-b border-[var(--border)]" role="tablist">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`border-b-2 pb-3 text-sm transition-colors ${
              isActive
                ? 'border-[var(--accent)] font-semibold text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
