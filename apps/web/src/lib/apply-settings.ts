import type { Theme } from '@content-insights/shared';

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

// The single place that actually mutates the document for a settings change. The theme
// palette itself lives in index.css as CSS custom properties keyed off [data-theme] — this
// only needs to flip that one attribute. Post-pivot UserSettings dropped the old
// appearance.fontSize/compactSidebar/cardDensity fields entirely (see user-settings.ts) —
// there is nothing else document-level left to apply.
export function applySettings(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}
