import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { DEFAULT_USER_SETTINGS, type UserSettingsDefaults } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { getApiErrorMessage } from '../lib/api-client';
import { applySettings } from '../lib/apply-settings';
import { getPath, pathToPatch, setPath } from '../lib/nested-path';
import { fetchMySettings, updateMySettings } from '../lib/settings-api';
import { readSettingsCache, writeSettingsCache } from '../lib/settings-storage';

const DEBOUNCE_MS = 600;

export interface SettingsContextValue {
  settings: UserSettingsDefaults;
  // `path` is a top-level UserSettingsDefaults key ('theme', 'dateFormat', ...) — there are
  // no nested objects left in the post-pivot flat shape to dot into. cardContentLines is a
  // single Record value in its own right, so updating it still goes through this same
  // one-arg-path call (`updateSetting('cardContentLines', nextRecord)`), matching the
  // server's "replaced wholesale, not merged key-by-key" contract (see
  // updateUserSettingsSchema's own comment in user-settings.schema.ts).
  updateSetting: (path: string, value: unknown) => void;
  isSyncing: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function asRecord(settings: UserSettingsDefaults): Record<string, unknown> {
  return settings;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<UserSettingsDefaults>(
    () => readSettingsCache() ?? DEFAULT_USER_SETTINGS,
  );
  const [isSyncing, setIsSyncing] = useState(false);

  // Keyed per-path so unrelated settings debounce independently — toggling two
  // different switches in quick succession shouldn't make the first one wait on the
  // second's timer.
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inFlightCountRef = useRef(0);

  useEffect(() => {
    applySettings(settings.theme);
  }, [settings.theme]);

  // 'system' theme: re-resolve and re-apply whenever the OS preference flips, not just
  // when the settings object itself changes.
  useEffect(() => {
    if (settings.theme !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => applySettings(settings.theme);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [settings.theme]);

  // Background boot fetch — the localStorage cache (or system defaults) is already
  // rendering via the initial useState above; this silently upgrades it once the real,
  // server-authoritative settings arrive. A failure here just means "keep showing the
  // fallback," never a visible error.
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let cancelled = false;
    fetchMySettings()
      .then((fetched) => {
        if (cancelled) {
          return;
        }
        const next: UserSettingsDefaults = {
          theme: fetched.theme,
          dateFormat: fetched.dateFormat,
          facetSortOrder: fetched.facetSortOrder,
          hideZeroCountFacets: fetched.hideZeroCountFacets,
          cardContentLines: fetched.cardContentLines,
          languagePreference: fetched.languagePreference,
          defaultResultView: fetched.defaultResultView,
        };
        setSettings(next);
        writeSettingsCache(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  function updateSetting(path: string, value: unknown): void {
    const previousValue = getPath(asRecord(settings), path);

    setSettings((current) => {
      const next = setPath(asRecord(current), path, value) as unknown as UserSettingsDefaults;
      writeSettingsCache(next);
      return next;
    });

    const timers = timersRef.current;
    clearTimeout(timers[path]);
    timers[path] = setTimeout(() => {
      inFlightCountRef.current += 1;
      setIsSyncing(true);

      updateMySettings(pathToPatch(path, value))
        .catch((err: unknown) => {
          setSettings((current) => {
            const rolledBack = setPath(
              asRecord(current),
              path,
              previousValue,
            ) as unknown as UserSettingsDefaults;
            writeSettingsCache(rolledBack);
            return rolledBack;
          });
          toast.error(getApiErrorMessage(err, 'Failed to save settings.'));
        })
        .finally(() => {
          inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
          if (inFlightCountRef.current === 0) {
            setIsSyncing(false);
          }
        });
    }, DEBOUNCE_MS);
  }

  const value: SettingsContextValue = { settings, updateSetting, isSyncing };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- same accepted pattern as AuthContext (Provider + hook colocated)
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}
