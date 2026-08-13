import { SOURCE_TYPE_TABS, type SourceTypeTab } from '@content-insights/shared';

import Tabs from './ui/tabs';

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
    <Tabs
      items={SOURCE_TYPE_TABS.map((tab) => ({ id: tab, label: TAB_LABELS[tab] }))}
      value={active}
      onChange={onChange}
      className="gap-4 [&_button]:px-0 [&_button]:pt-0"
    />
  );
}
