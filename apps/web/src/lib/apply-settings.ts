import type { Theme } from '@content-insights/shared';

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

// The single place that mutates the document for a settings change. shadcn dark mode
// is the `.dark` class on <html>; this only needs to add or remove that class.
export function applySettings(theme: Theme): void {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}
