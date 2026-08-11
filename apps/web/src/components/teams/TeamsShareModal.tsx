import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, X } from 'lucide-react';

import type { TeamsShareArticleRef, TeamsShareRecord } from '@content-insights/shared';

import { getApiErrorMessage } from '../../lib/api-client';
import { fetchGlobalSettings } from '../../lib/global-settings-api';
import { formatDate } from '../../lib/format';
import { INPUT_CLASSNAME } from '../../lib/form-styles';
import { shareToTeams, TEAMS_MAX_ARTICLES_PER_SHARE, TEAMS_MESSAGE_MAX_LENGTH } from '../../lib/teams-api';
import Toggle from '../Toggle';

const MAX_VISIBLE_ARTICLE_PREVIEW = 5;

// -----------------------------------------------------------------------------------------
// MentionsInput — a plain comma/chip input, deliberately with no directory lookup: per the
// brief, mentions here are freeform strings (a name, an email, whatever the sharer types),
// not resolved against a real user/AAD directory the way a live Teams @mention would be.
// -----------------------------------------------------------------------------------------
function MentionsInput({ mentions, onChange }: { mentions: string[]; onChange: (mentions: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function commit() {
    const trimmed = draft.trim().replace(/^@/, '');
    if (trimmed && !mentions.includes(trimmed)) {
      onChange([...mentions, trimmed]);
    }
    setDraft('');
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && mentions.length > 0) {
      onChange(mentions.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 focus-within:border-[var(--accent)]">
      {mentions.map((mention) => (
        <span
          key={mention}
          className="flex items-center gap-1 rounded-[var(--radius-tag)] px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
        >
          @{mention}
          <button
            type="button"
            onClick={() => onChange(mentions.filter((m) => m !== mention))}
            aria-label={`Remove @${mention}`}
            className="hover:text-[var(--red)]"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={mentions.length === 0 ? 'Type a name, press Enter or comma…' : 'Add another…'}
        className="min-w-[160px] flex-1 bg-transparent py-0.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
      />
    </div>
  );
}

function ArticlePreviewList({ articles, useAppDeepLink }: { articles: TeamsShareArticleRef[]; useAppDeepLink: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? articles : articles.slice(0, MAX_VISIBLE_ARTICLE_PREVIEW);
  const overflow = articles.length - visible.length;

  return (
    <div className="rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-2.5">
      <ul className="space-y-1.5">
        {visible.map((article, index) => (
          <li key={`${article.url}-${index}`} className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            {useAppDeepLink ? (
              <Link2 size={13} className="shrink-0 text-[var(--text-muted)]" />
            ) : (
              <ExternalLink size={13} className="shrink-0 text-[var(--text-muted)]" />
            )}
            <span className="min-w-0 flex-1 truncate">{article.title}</span>
          </li>
        ))}
      </ul>
      {overflow > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1.5 text-xs text-[var(--accent)] hover:underline"
        >
          +{overflow} more
        </button>
      ) : null}
    </div>
  );
}

function ConfirmationView({
  record,
  articleCount,
  onClose,
}: {
  record: TeamsShareRecord;
  articleCount: number;
  onClose: () => void;
}) {
  return (
    <div className="px-6 py-6">
      <div className="flex items-start gap-3 rounded-[var(--radius-input)] border border-[var(--green)] bg-[var(--accent-soft)] p-4">
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-[var(--green)]" />
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Share recorded</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            No live Microsoft Teams connection is configured in this environment, so nothing was actually posted to a
            Teams channel — this recorded what would have been shared.
          </p>
        </div>
      </div>

      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-secondary)]">Articles</dt>
          <dd className="text-[var(--text-primary)]">{articleCount}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-secondary)]">Mentions</dt>
          <dd className="text-right text-[var(--text-primary)]">
            {record.mentions.length > 0 ? record.mentions.map((m) => `@${m}`).join(', ') : 'None'}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-secondary)]">Recorded at</dt>
          <dd className="text-[var(--text-primary)]">{formatDate(record.createdAt)}</dd>
        </div>
        {record.message ? (
          <div>
            <dt className="text-[var(--text-secondary)]">Message</dt>
            <dd className="mt-1 whitespace-pre-wrap rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-primary)] p-2.5 text-[var(--text-primary)]">
              {record.message}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-secondary)]">Record ID</dt>
          <dd className="font-mono text-xs text-[var(--text-muted)]">{record.id}</dd>
        </div>
      </dl>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius-button)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export interface TeamsShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The article(s) being shared — pass a single-item array for the single-article variant. */
  articles: TeamsShareArticleRef[];
  /** Fired after a successful share, with the server's confirmation record. */
  onShared?: (record: TeamsShareRecord) => void;
}

// ---------------------------------------------------------------------------------------
// Single-article and bulk shares are the exact same component/payload shape
// (TeamsShareRequest.articles is always an array) — only the header copy and cap-checking
// change based on articles.length. See teams.ts's own module comment: no live MS Graph
// credentials are configured, so a submitted share is recorded (TeamsShareRecord,
// simulated: true) rather than posted to a real Teams channel — the notice below says so
// plainly so nobody mistakes this for a live integration.
// ---------------------------------------------------------------------------------------
export default function TeamsShareModal({ isOpen, onClose, articles, onShared }: TeamsShareModalProps) {
  const [message, setMessage] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [useAppDeepLink, setUseAppDeepLink] = useState(true);
  const [shareRecord, setShareRecord] = useState<TeamsShareRecord | null>(null);

  // Reset the draft every time the modal is (re)opened — a close-without-submit should
  // never leak a half-composed message into the next share.
  useEffect(() => {
    if (isOpen) {
      setMessage('');
      setMentions([]);
      setUseAppDeepLink(true);
      setShareRecord(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // GET /settings/global is gated on global-settings:manage, which most users sharing an
  // article won't hold — that 403 is expected and silently ignored (queries don't
  // auto-toast, only mutations do; see query-client.ts), falling back to the client-side
  // sanity ceiling. The server enforces the org's real (possibly tighter) configured limit
  // regardless of what this client could discover, so under-fetching here is only ever a
  // UX nicety, never a correctness gap.
  const globalSettingsQuery = useQuery({
    queryKey: ['global-settings'],
    queryFn: fetchGlobalSettings,
    enabled: isOpen,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const maxArticlesPerShare = globalSettingsQuery.data?.msTeams.maxArticlesPerShare ?? TEAMS_MAX_ARTICLES_PER_SHARE;
  const overCap = articles.length > maxArticlesPerShare;

  const shareMutation = useMutation({
    mutationFn: () => shareToTeams({ message: message.trim(), mentions, articles, useAppDeepLink }),
    onSuccess: (record) => {
      setShareRecord(record);
      onShared?.(record);
      toast.success('Share recorded.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to record this Teams share.')),
    meta: { skipToast: true },
  });

  if (!isOpen) {
    return null;
  }

  const isBulk = articles.length > 1;
  const title = isBulk ? `Share ${articles.length} articles to Microsoft Teams` : 'Share to Microsoft Teams';
  const canSubmit = articles.length > 0 && !overCap && !shareMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10" onClick={onClose}>
      <div
        data-testid="teams-share-modal"
        className="w-full max-w-lg rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X size={18} />
          </button>
        </div>

        {shareRecord ? (
          <ConfirmationView record={shareRecord} articleCount={articles.length} onClose={onClose} />
        ) : (
          <div className="max-h-[75vh] space-y-4 overflow-y-auto px-6 py-5">
            <div className="flex items-start gap-2 rounded-[var(--radius-input)] border border-[var(--amber)] bg-[var(--accent-soft)] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--amber)]" />
              <p>
                This records the share for now — no live Microsoft Teams connection is configured in this
                environment. Nothing will actually be posted to a Teams channel.
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">
                {isBulk ? `Articles (${articles.length})` : 'Article'}
              </p>
              <ArticlePreviewList articles={articles} useAppDeepLink={useAppDeepLink} />
            </div>

            {overCap ? (
              <p className="rounded-[var(--radius-input)] border border-[var(--red)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--red)]">
                This share includes {articles.length} articles, which exceeds your organization&apos;s limit of{' '}
                {maxArticlesPerShare} articles per Teams share. Remove some articles before sharing.
              </p>
            ) : null}

            <div>
              <label htmlFor="teams-share-message" className="block text-sm font-medium text-[var(--text-secondary)]">
                Message <span className="text-xs font-normal text-[var(--text-muted)]">(optional)</span>
              </label>
              <textarea
                id="teams-share-message"
                rows={4}
                maxLength={TEAMS_MESSAGE_MAX_LENGTH}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Add context for the people you're sharing with…"
                className={`mt-1 resize-none ${INPUT_CLASSNAME}`}
              />
              <p
                className={`mt-1 text-right text-xs ${
                  message.length >= TEAMS_MESSAGE_MAX_LENGTH ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {message.length} / {TEAMS_MESSAGE_MAX_LENGTH}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)]">
                Mentions <span className="text-xs font-normal text-[var(--text-muted)]">(optional — no directory lookup, just names)</span>
              </label>
              <div className="mt-1">
                <MentionsInput mentions={mentions} onChange={setMentions} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-[var(--radius-input)] border border-[var(--border)] p-3">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {useAppDeepLink ? 'Sharing app deep links' : 'Sharing original source URLs'}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  {useAppDeepLink
                    ? 'Recipients open each article inside this app.'
                    : "Recipients open each article's original source page directly."}
                </p>
              </div>
              <Toggle checked={useAppDeepLink} onChange={setUseAppDeepLink} label="Use app deep links" />
            </div>
          </div>
        )}

        {shareRecord ? null : (
          <div className="flex justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => shareMutation.mutate()}
              disabled={!canSubmit}
              className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {shareMutation.isPending ? 'Sharing…' : 'Share to Teams'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
