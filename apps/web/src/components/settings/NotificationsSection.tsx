import type { NotificationSettings } from '@content-insights/shared';

import { useSettings } from '../../settings/SettingsContext';
import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import Toggle from '../Toggle';
import SettingsSaveBar from './SettingsSaveBar';
import { SETTINGS_SELECT_CLASSNAME, SettingsRow, SettingsSection } from './SettingsSection';

export default function NotificationsSection() {
  const { settings, updateSetting } = useSettings();
  const committed = settings.notifications;
  const { draft, setDraft, isDirty, discard } = useDirtyDraft<NotificationSettings>(committed);

  function handleSave() {
    if (draft.emailDigest !== committed.emailDigest) {
      updateSetting('notifications.emailDigest', draft.emailDigest);
    }
    if (draft.emailDigestFrequency !== committed.emailDigestFrequency) {
      updateSetting('notifications.emailDigestFrequency', draft.emailDigestFrequency);
    }
    if (draft.inAppAlerts.breakingNews !== committed.inAppAlerts.breakingNews) {
      updateSetting('notifications.inAppAlerts.breakingNews', draft.inAppAlerts.breakingNews);
    }
    if (draft.inAppAlerts.tagMatches !== committed.inAppAlerts.tagMatches) {
      updateSetting('notifications.inAppAlerts.tagMatches', draft.inAppAlerts.tagMatches);
    }
    if (draft.inAppAlerts.system !== committed.inAppAlerts.system) {
      updateSetting('notifications.inAppAlerts.system', draft.inAppAlerts.system);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Email" description="A periodic summary emailed to you.">
        <SettingsRow label="Email digest">
          <Toggle
            checked={draft.emailDigest}
            onChange={(checked) => setDraft((current) => ({ ...current, emailDigest: checked }))}
            label="Email digest"
          />
        </SettingsRow>

        <SettingsRow label="Digest frequency">
          <select
            disabled={!draft.emailDigest}
            className={`${SETTINGS_SELECT_CLASSNAME} disabled:cursor-not-allowed disabled:opacity-50`}
            value={draft.emailDigestFrequency}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                emailDigestFrequency: event.target.value as NotificationSettings['emailDigestFrequency'],
              }))
            }
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="In-app alerts">
        <SettingsRow label="Breaking news" description="Alert when breaking news arrives.">
          <Toggle
            checked={draft.inAppAlerts.breakingNews}
            onChange={(checked) =>
              setDraft((current) => ({
                ...current,
                inAppAlerts: { ...current.inAppAlerts, breakingNews: checked },
              }))
            }
            label="Breaking news alerts"
          />
        </SettingsRow>

        <SettingsRow label="Tag matches" description="Alert when a followed tag appears.">
          <Toggle
            checked={draft.inAppAlerts.tagMatches}
            onChange={(checked) =>
              setDraft((current) => ({
                ...current,
                inAppAlerts: { ...current.inAppAlerts, tagMatches: checked },
              }))
            }
            label="Tag match alerts"
          />
        </SettingsRow>

        <SettingsRow label="System" description="Alert for system and account notices.">
          <Toggle
            checked={draft.inAppAlerts.system}
            onChange={(checked) =>
              setDraft((current) => ({
                ...current,
                inAppAlerts: { ...current.inAppAlerts, system: checked },
              }))
            }
            label="System alerts"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSaveBar isDirty={isDirty} onSave={handleSave} onDiscard={discard} />
    </div>
  );
}
