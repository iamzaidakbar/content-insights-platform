import { AlignJustify, Grid2x2, Grid3x3, List } from 'lucide-react';

import type { SearchLayout, SearchPageSize, SearchSettings, SearchSort } from '@content-insights/shared';

import { useSettings } from '../../settings/SettingsContext';
import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import SettingsSaveBar from './SettingsSaveBar';
import { SETTINGS_SELECT_CLASSNAME, SettingsRow, SettingsSection } from './SettingsSection';

const PAGE_SIZE_OPTIONS: SearchPageSize[] = [12, 24, 48];
const SORT_OPTIONS: { value: SearchSort; label: string }[] = [
  { value: 'publishDate', label: 'Publish Date' },
  { value: 'relevance', label: 'Relevance' },
  { value: 'source', label: 'Source' },
];
const LAYOUT_OPTIONS: { value: SearchLayout; label: string; icon: typeof List }[] = [
  { value: '1col', label: '1 column', icon: List },
  { value: '2col', label: '2 columns', icon: Grid2x2 },
  { value: '3col', label: '3 columns', icon: Grid3x3 },
  { value: 'dense', label: 'Dense', icon: AlignJustify },
];
const OPEN_ARTICLE_OPTIONS: { value: SearchSettings['openArticleIn']; label: string }[] = [
  { value: 'newTab', label: 'New tab' },
  { value: 'sameTab', label: 'Same tab' },
  { value: 'sidePanel', label: 'Side panel' },
];

export default function SearchPreferencesSection() {
  const { settings, updateSetting } = useSettings();
  const committed = settings.search;
  const { draft, setDraft, isDirty, discard } = useDirtyDraft<SearchSettings>(committed);

  function handleSave() {
    if (draft.defaultPageSize !== committed.defaultPageSize) {
      updateSetting('search.defaultPageSize', draft.defaultPageSize);
    }
    if (draft.defaultSort !== committed.defaultSort) {
      updateSetting('search.defaultSort', draft.defaultSort);
    }
    if (draft.defaultLayout !== committed.defaultLayout) {
      updateSetting('search.defaultLayout', draft.defaultLayout);
    }
    if (draft.openArticleIn !== committed.openArticleIn) {
      updateSetting('search.openArticleIn', draft.openArticleIn);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Search Preferences" description="Defaults applied every time you open Articles.">
        <SettingsRow label="Results per page">
          <select
            className={SETTINGS_SELECT_CLASSNAME}
            value={draft.defaultPageSize}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                defaultPageSize: Number(event.target.value) as SearchPageSize,
              }))
            }
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow label="Default sort">
          <select
            className={SETTINGS_SELECT_CLASSNAME}
            value={draft.defaultSort}
            onChange={(event) =>
              setDraft((current) => ({ ...current, defaultSort: event.target.value as SearchSort }))
            }
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow label="Default layout">
          <div className="flex items-center gap-1 rounded-[var(--radius-button)] border border-[var(--border)] p-1">
            {LAYOUT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = draft.defaultLayout === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  onClick={() => setDraft((current) => ({ ...current, defaultLayout: option.value }))}
                  className="flex h-8 w-8 items-center justify-center rounded-[calc(var(--radius-button)-2px)] transition-colors"
                  style={
                    isActive
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                      : { color: 'var(--text-secondary)' }
                  }
                >
                  <Icon size={16} strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow label="Open article in">
          <div className="flex items-center gap-4">
            {OPEN_ARTICLE_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="radio"
                  name="search-open-article-in"
                  checked={draft.openArticleIn === option.value}
                  onChange={() => setDraft((current) => ({ ...current, openArticleIn: option.value }))}
                  className="h-4 w-4 border-[var(--border)] accent-[var(--accent)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSaveBar isDirty={isDirty} onSave={handleSave} onDiscard={discard} />
    </div>
  );
}
