import type { UserSettingsDefaults } from '@content-insights/shared';

export function resolveTheme(theme: UserSettingsDefaults['appearance']['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

// The single place that actually mutates the document for a settings change. The theme
// palette itself lives in index.css as CSS custom properties keyed off [data-theme] — this
// only needs to flip that one attribute (plus data-font-size, which scales --font-scale).
// compactSidebar/cardDensity are deliberately NOT applied here: they're read directly via
// useSettings() by the specific components that care (the sidebar's own width, a future
// card grid's padding), not global document-level concerns.
export function applySettings(settings: UserSettingsDefaults): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolveTheme(settings.appearance.theme));
  root.setAttribute('data-font-size', settings.appearance.fontSize);
}
