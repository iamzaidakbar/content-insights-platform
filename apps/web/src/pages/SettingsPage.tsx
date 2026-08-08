import type { ReactNode } from 'react';

import { useSettings } from '../settings/SettingsContext';
import Toggle from '../components/Toggle';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const SELECT_CLASSNAME =
  'rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';

export default function SettingsPage() {
  const { settings, updateSetting, isSyncing } = useSettings();
  const { appearance, search, notifications } = settings;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Settings</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Personal preferences — changes save automatically.
          </p>
        </div>
        <span
          className="text-xs text-[var(--text-muted)] transition-opacity"
          style={{ opacity: isSyncing ? 1 : 0 }}
        >
          Saving…
        </span>
      </div>

      <div className="mt-8 space-y-6">
        <Section title="Appearance" description="Theme, density, and layout preferences.">
          <Row label="Theme" description="Follows your system setting, or pick one explicitly.">
            <select
              className={SELECT_CLASSNAME}
              value={appearance.theme}
              onChange={(event) => updateSetting('appearance.theme', event.target.value)}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </Row>

          <Row label="Font size">
            <select
              className={SELECT_CLASSNAME}
              value={appearance.fontSize}
              onChange={(event) => updateSetting('appearance.fontSize', event.target.value)}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </Row>

          <Row label="Compact sidebar" description="Collapse the sidebar to icons only.">
            <Toggle
              checked={appearance.compactSidebar}
              onChange={(checked) => updateSetting('appearance.compactSidebar', checked)}
              label="Compact sidebar"
            />
          </Row>

          <Row label="Card density">
            <select
              className={SELECT_CLASSNAME}
              value={appearance.cardDensity}
              onChange={(event) => updateSetting('appearance.cardDensity', event.target.value)}
            >
              <option value="comfortable">Comfortable</option>
              <option value="cozy">Cozy</option>
              <option value="compact">Compact</option>
            </select>
          </Row>
        </Section>

        <Section title="Search" description="Defaults applied every time you open search.">
          <Row label="Results per page">
            <select
              className={SELECT_CLASSNAME}
              value={search.defaultPageSize}
              onChange={(event) =>
                updateSetting('search.defaultPageSize', Number(event.target.value))
              }
            >
              <option value={12}>12</option>
              <option value={24}>24</option>
              <option value={48}>48</option>
            </select>
          </Row>

          <Row label="Sort by">
            <select
              className={SELECT_CLASSNAME}
              value={search.defaultSort}
              onChange={(event) => updateSetting('search.defaultSort', event.target.value)}
            >
              <option value="publishDate">Publish date</option>
              <option value="relevance">Relevance</option>
              <option value="source">Source</option>
            </select>
          </Row>

          <Row label="Layout">
            <select
              className={SELECT_CLASSNAME}
              value={search.defaultLayout}
              onChange={(event) => updateSetting('search.defaultLayout', event.target.value)}
            >
              <option value="1col">1 column</option>
              <option value="2col">2 columns</option>
              <option value="3col">3 columns</option>
              <option value="dense">Dense</option>
            </select>
          </Row>

          <Row label="Open articles in">
            <select
              className={SELECT_CLASSNAME}
              value={search.openArticleIn}
              onChange={(event) => updateSetting('search.openArticleIn', event.target.value)}
            >
              <option value="newTab">New tab</option>
              <option value="sameTab">Same tab</option>
              <option value="sidePanel">Side panel</option>
            </select>
          </Row>
        </Section>

        <Section title="Notifications" description="Email digests and in-app alerts.">
          <Row label="Email digest" description="A periodic summary emailed to you.">
            <Toggle
              checked={notifications.emailDigest}
              onChange={(checked) => updateSetting('notifications.emailDigest', checked)}
              label="Email digest"
            />
          </Row>

          {notifications.emailDigest ? (
            <Row label="Digest frequency">
              <select
                className={SELECT_CLASSNAME}
                value={notifications.emailDigestFrequency}
                onChange={(event) =>
                  updateSetting('notifications.emailDigestFrequency', event.target.value)
                }
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </Row>
          ) : null}

          <Row label="Breaking news" description="In-app alert for breaking news.">
            <Toggle
              checked={notifications.inAppAlerts.breakingNews}
              onChange={(checked) =>
                updateSetting('notifications.inAppAlerts.breakingNews', checked)
              }
              label="Breaking news alerts"
            />
          </Row>

          <Row label="Tag matches" description="In-app alert when a followed tag appears.">
            <Toggle
              checked={notifications.inAppAlerts.tagMatches}
              onChange={(checked) => updateSetting('notifications.inAppAlerts.tagMatches', checked)}
              label="Tag match alerts"
            />
          </Row>

          <Row label="System" description="In-app alert for system/account notices.">
            <Toggle
              checked={notifications.inAppAlerts.system}
              onChange={(checked) => updateSetting('notifications.inAppAlerts.system', checked)}
              label="System alerts"
            />
          </Row>
        </Section>
      </div>
    </div>
  );
}
