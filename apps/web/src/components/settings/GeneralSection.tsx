import { Monitor, Moon, Sun } from 'lucide-react';

import { DATE_FORMATS, type DateFormatPreference, type Theme } from '@content-insights/shared';

import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import { useSettings } from '../../settings/SettingsContext';
import SettingsSaveBar from './SettingsSaveBar';
import { SETTINGS_SELECT_CLASSNAME, SettingsRow, SettingsSection } from './SettingsSection';

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

// Every DATE_FORMATS entry rendered against today's date, so the dropdown shows a live
// example rather than a bare format-code string like "MMM D, YYYY".
function formatExample(pattern: DateFormatPreference): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const monthShort = now.toLocaleDateString('en-US', { month: 'short' });
  const day = String(now.getDate());
  switch (pattern) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'DD/MM/YYYY':
      return `${dd}/${mm}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'MMM D, YYYY':
      return `${monthShort} ${day}, ${yyyy}`;
    case 'D MMM YYYY':
      return `${day} ${monthShort} ${yyyy}`;
    default:
      return pattern;
  }
}

interface GeneralDraft {
  theme: Theme;
  dateFormat: DateFormatPreference;
  languagePreference: string;
}

// Post-pivot UserSettings is a flat record (theme/dateFormat/facetSortOrder/
// hideZeroCountFacets/cardContentLines/languagePreference/defaultResultView) — the old
// nested appearance/search/notifications objects, and every field on them (fontSize,
// compactSidebar, cardDensity, emailDigest, inAppAlerts, ...) are gone. This section now
// covers just the display/localization prefs that don't belong under Search Preferences:
// theme, date format, and language. The old read-only "Overview" (email/org/permissions)
// that used to live here moved to Account, which is the more natural home for "facts about
// you and your access."
export default function GeneralSection() {
  const { settings, updateSetting } = useSettings();
  const committed: GeneralDraft = {
    theme: settings.theme,
    dateFormat: settings.dateFormat,
    languagePreference: settings.languagePreference,
  };
  const { draft, setDraft, isDirty, discard } = useDirtyDraft<GeneralDraft>(committed);

  function handleSave() {
    if (draft.theme !== committed.theme) {
      updateSetting('theme', draft.theme);
    }
    if (draft.dateFormat !== committed.dateFormat) {
      updateSetting('dateFormat', draft.dateFormat);
    }
    const trimmedLanguage = draft.languagePreference.trim();
    if (trimmedLanguage.length > 0 && trimmedLanguage !== committed.languagePreference) {
      updateSetting('languagePreference', trimmedLanguage);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Theme" description="Pick a look, or follow your system setting.">
        <div className="flex flex-wrap gap-3">
          {THEME_OPTIONS.map((option) => {
            const isActive = draft.theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, theme: option.value }))}
                className="flex items-center gap-2 rounded-[var(--radius-button)] px-4 py-2.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: isActive ? 'var(--accent-soft)' : 'var(--bg-card)',
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                }}
              >
                <option.icon size={15} strokeWidth={1.75} />
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Localization" description="Applied wherever dates and language-specific content are shown.">
        <SettingsRow label="Date format" description={`Example: ${formatExample(draft.dateFormat)}`}>
          <select
            className={SETTINGS_SELECT_CLASSNAME}
            value={draft.dateFormat}
            onChange={(event) =>
              setDraft((current) => ({ ...current, dateFormat: event.target.value as DateFormatPreference }))
            }
          >
            {DATE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format} — {formatExample(format)}
              </option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow label="Language" description="ISO language code, e.g. en, fr, de.">
          <input
            type="text"
            value={draft.languagePreference}
            onChange={(event) => setDraft((current) => ({ ...current, languagePreference: event.target.value }))}
            maxLength={35}
            placeholder="en"
            className="w-32 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSaveBar isDirty={isDirty} onSave={handleSave} onDiscard={discard} />
    </div>
  );
}
