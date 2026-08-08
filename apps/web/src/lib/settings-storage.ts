import type { UserSettingsDefaults } from '@content-insights/shared';

const CACHE_KEY = 'ci-settings-cache';

export function readSettingsCache(): UserSettingsDefaults | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'appearance' in parsed &&
      'search' in parsed &&
      'notifications' in parsed
    ) {
      return parsed as UserSettingsDefaults;
    }
    return null;
  } catch {
    // Corrupt/unavailable localStorage (private browsing, quota, hand-edited value) is
    // never fatal — just means no fallback until the network fetch resolves.
    return null;
  }
}

export function writeSettingsCache(settings: UserSettingsDefaults): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full/unavailable — settings still work for this session, just without a
    // fallback on next load. Not worth surfacing to the user.
  }
}
