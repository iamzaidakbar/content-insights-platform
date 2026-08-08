import { useEffect, useRef } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';

import type { AppearanceSettings, CardDensity, FontSize, Theme } from '@content-insights/shared';

import { useSettings } from '../../settings/SettingsContext';
import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import { resolveTheme } from '../../lib/apply-settings';
import Toggle from '../Toggle';
import SettingsSaveBar from './SettingsSaveBar';
import { SettingsSection } from './SettingsSection';

const THEME_PALETTES: Record<'light' | 'dark', { bg: string; panel: string; line: string }> = {
  light: { bg: '#f4f5f9', panel: '#ffffff', line: '#c7c9d9' },
  dark: { bg: '#0f1117', panel: '#1a1d27', line: '#3a3d5a' },
};

// Mini UI mockup thumbnails, not literal emoji — matches this app's icon-driven design
// system (lucide throughout) rather than the ☀️🌙💻 characters in the raw spec text.
function ThemeMockup({ variant }: { variant: Theme }) {
  if (variant === 'system') {
    return (
      <svg width="72" height="44" viewBox="0 0 72 44" className="overflow-hidden rounded-[4px]">
        <rect width="36" height="44" fill={THEME_PALETTES.dark.bg} />
        <rect x="36" width="36" height="44" fill={THEME_PALETTES.light.bg} />
        <rect x="4" y="7" width="9" height="30" fill={THEME_PALETTES.dark.panel} />
        <rect x="40" y="7" width="9" height="30" fill={THEME_PALETTES.light.panel} />
        <rect x="18" y="10" width="14" height="3" fill={THEME_PALETTES.dark.line} />
        <rect x="18" y="17" width="10" height="3" fill={THEME_PALETTES.dark.line} />
        <rect x="54" y="10" width="14" height="3" fill={THEME_PALETTES.light.line} />
        <rect x="54" y="17" width="10" height="3" fill={THEME_PALETTES.light.line} />
      </svg>
    );
  }
  const palette = THEME_PALETTES[variant];
  return (
    <svg width="72" height="44" viewBox="0 0 72 44" className="overflow-hidden rounded-[4px]">
      <rect width="72" height="44" fill={palette.bg} />
      <rect x="4" y="7" width="13" height="30" fill={palette.panel} />
      <rect x="22" y="9" width="26" height="3" fill={palette.line} />
      <rect x="22" y="16" width="40" height="3" fill={palette.line} />
      <rect x="22" y="23" width="34" height="3" fill={palette.line} />
      <rect x="22" y="30" width="20" height="3" fill={palette.line} />
    </svg>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

const FONT_SIZE_STEPS: FontSize[] = ['small', 'medium', 'large'];
const FONT_SIZE_LABELS: Record<FontSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' };

const DENSITY_OPTIONS: CardDensity[] = ['comfortable', 'compact', 'cozy'];
const DENSITY_LABELS: Record<CardDensity, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  cozy: 'Cozy',
};
// Mirrors ArticleCard.tsx's own SNIPPET_LINE_CLAMP/MAX_VISIBLE_TAGS constants — kept as a
// separate local mapping (not imported) since those are internal to ArticleCard's default
// export, but the numbers must stay in sync for this preview to be honest.
const DENSITY_PREVIEW: Record<CardDensity, { lines: number; tags: number }> = {
  comfortable: { lines: 4, tags: 5 },
  compact: { lines: 2, tags: 2 },
  cozy: { lines: 3, tags: 3 },
};

function CardDensityPreview({ density }: { density: CardDensity }) {
  const { lines, tags } = DENSITY_PREVIEW[density];
  return (
    <div className="w-64 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <div className="h-3 w-3/4 rounded bg-[var(--bg-hover)]" />
      <div className="mt-2 space-y-1.5">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className="h-2 rounded bg-[var(--bg-hover)]"
            style={{ width: index === lines - 1 ? '55%' : '100%' }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {Array.from({ length: tags }, (_, index) => (
          <span
            key={index}
            className="h-4 w-10 rounded-[var(--radius-tag)]"
            style={{ backgroundColor: 'var(--tag-bg)' }}
          />
        ))}
      </div>
    </div>
  );
}

export default function AppearanceSection() {
  const { settings, updateSetting } = useSettings();
  const committed = settings.appearance;
  const { draft, setDraft, isDirty, discard } = useDirtyDraft<AppearanceSettings>(committed);

  // Optimistic global preview for theme/font-size — applied to <html> the instant the
  // user picks a card or moves the slider, before Save is ever clicked (per spec). Reuses
  // the exact same attributes lib/apply-settings.ts's applySettings() writes, so the
  // preview and the real post-save appearance are pixel-identical.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolveTheme(draft.theme));
    root.setAttribute('data-font-size', draft.fontSize);
  }, [draft.theme, draft.fontSize]);

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const committedRef = useRef(committed);
  committedRef.current = committed;
  useEffect(() => {
    // Unmount-only revert: if the user navigates to a different settings section (or away
    // from the page entirely) with an unsaved theme/font-size preview still applied, don't
    // leave the whole app visually out of sync with what's actually persisted.
    return () => {
      if (isDirtyRef.current) {
        const root = document.documentElement;
        root.setAttribute('data-theme', resolveTheme(committedRef.current.theme));
        root.setAttribute('data-font-size', committedRef.current.fontSize);
      }
    };
  }, []);

  function handleDiscard() {
    discard();
    const root = document.documentElement;
    root.setAttribute('data-theme', resolveTheme(committed.theme));
    root.setAttribute('data-font-size', committed.fontSize);
  }

  function handleSave() {
    if (draft.theme !== committed.theme) {
      updateSetting('appearance.theme', draft.theme);
    }
    if (draft.fontSize !== committed.fontSize) {
      updateSetting('appearance.fontSize', draft.fontSize);
    }
    if (draft.compactSidebar !== committed.compactSidebar) {
      updateSetting('appearance.compactSidebar', draft.compactSidebar);
    }
    if (draft.cardDensity !== committed.cardDensity) {
      updateSetting('appearance.cardDensity', draft.cardDensity);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Theme" description="Pick a look, or follow your system setting.">
        <div className="flex flex-wrap gap-4">
          {THEME_OPTIONS.map((option) => {
            const isActive = draft.theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, theme: option.value }))}
                className="relative flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] transition-colors"
                style={{
                  width: 160,
                  height: 100,
                  backgroundColor: 'var(--bg-card)',
                  border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                }}
              >
                {isActive ? (
                  <span
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    <Check size={12} strokeWidth={3} />
                  </span>
                ) : null}
                <ThemeMockup variant={option.value} />
                <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                  <option.icon size={14} />
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Text size" description="Scales text across the whole app.">
        <div className="max-w-sm">
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={FONT_SIZE_STEPS.indexOf(draft.fontSize)}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                fontSize: FONT_SIZE_STEPS[Number(event.target.value)] ?? current.fontSize,
              }))
            }
            className="w-full accent-[var(--accent)]"
          />
          <div className="mt-1 flex justify-between text-xs text-[var(--text-secondary)]">
            {FONT_SIZE_STEPS.map((step) => (
              <span key={step} className={step === draft.fontSize ? 'font-medium text-[var(--text-primary)]' : ''}>
                {FONT_SIZE_LABELS[step]}
              </span>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Layout">
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Compact sidebar</p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Collapse the sidebar to icons only (60px), or expand it with labels (220px).
            </p>
          </div>
          <Toggle
            checked={draft.compactSidebar}
            onChange={(checked) => setDraft((current) => ({ ...current, compactSidebar: checked }))}
            label="Compact sidebar"
          />
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Card density</p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Controls how much snippet text and how many tags each article card shows.
          </p>
          <div className="mt-3 flex gap-4">
            {DENSITY_OPTIONS.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="radio"
                  name="appearance-card-density"
                  checked={draft.cardDensity === option}
                  onChange={() => setDraft((current) => ({ ...current, cardDensity: option }))}
                  className="h-4 w-4 border-[var(--border)] accent-[var(--accent)]"
                />
                {DENSITY_LABELS[option]}
              </label>
            ))}
          </div>
          <div className="mt-3">
            <CardDensityPreview density={draft.cardDensity} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSaveBar isDirty={isDirty} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  );
}
