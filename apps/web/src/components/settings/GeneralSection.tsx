import { Monitor, Moon, Sun } from 'lucide-react';

import { DATE_FORMATS, type DateFormatPreference, type Theme } from '@content-insights/shared';

import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import { useSettings } from '../../settings/SettingsContext';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
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
    <div className="space-y-4">
      <SettingsSection title="Theme" description="Pick a look, or follow your system setting.">
        <ToggleGroup
          type="single"
          variant="outline"
          value={draft.theme}
          onValueChange={(value) => {
            if (value === 'light' || value === 'dark' || value === 'system') {
              setDraft((current) => ({ ...current, theme: value }));
            }
          }}
        >
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
                <Icon className="size-4" />
                {option.label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
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
            className="w-32 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSaveBar isDirty={isDirty} onSave={handleSave} onDiscard={discard} />
    </div>
  );
}
