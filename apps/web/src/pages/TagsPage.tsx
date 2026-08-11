import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BadgeCheck, Globe, Lock, Tag as TagIcon, X } from 'lucide-react';

import { USER_TAG_NAME_MAX_LENGTH, type Permission, type UserTag } from '@content-insights/shared';

import EmptyState from '../components/EmptyState';
import Toggle from '../components/Toggle';
import { useAuth } from '../auth/AuthContext';
import { getApiErrorMessage } from '../lib/api-client';
import { INPUT_CLASSNAME } from '../lib/form-styles';
import { fetchGroup, fetchGroups } from '../lib/groups-api';
import { fetchRoles } from '../lib/roles-api';
import { hasScopedPermission } from '../lib/scoped-permissions';
import {
  createUserTag,
  deleteUserTag,
  fetchUserTags,
  publishUserTag,
  revokeUserTagShare,
  shareUserTag,
  updateUserTag,
} from '../lib/user-tags-api';

const SKELETON_ROW_COUNT = 4;

// ---------------------------------------------------------------------------------------
// Shared dialog chrome — same fixed-overlay treatment used across the app's per-row action
// modals (AddMemberModal, GroupsPage's NewGroupModal, SavedQueriesModal's own Dialog).
// ---------------------------------------------------------------------------------------
function Dialog({
  title,
  onClose,
  children,
  widthClassName = 'max-w-sm',
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
  testId?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        data-testid={testId}
        className={`w-full ${widthClassName} rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function RenameDialog({ tag, onClose, onRenamed }: { tag: UserTag; onClose: () => void; onRenamed: () => void }) {
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);

  const renameMutation = useMutation({
    mutationFn: () => updateUserTag(tag.id, { name: name.trim() }),
    onSuccess: () => {
      onRenamed();
      toast.success('Tag renamed.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to rename this tag.')),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    renameMutation.mutate();
  }

  return (
    <Dialog title="Rename tag" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={USER_TAG_NAME_MAX_LENGTH}
            className={INPUT_CLASSNAME}
          />
          <p className="mt-1 text-right text-xs text-[var(--text-muted)]">
            {name.length}/{USER_TAG_NAME_MAX_LENGTH}
          </p>
        </div>
        {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={renameMutation.isPending}
            className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {renameMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteConfirmDialog({
  tag,
  onClose,
  onDeleted,
}: {
  tag: UserTag;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => deleteUserTag(tag.id),
    onSuccess: () => {
      onDeleted();
      toast.success('Tag deleted and removed from every article that used it.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to delete this tag.')),
  });

  return (
    <Dialog title="Delete tag?" onClose={onClose} testId="delete-tag-dialog">
      <p className="text-sm text-[var(--text-secondary)]">
        &quot;{tag.name}&quot; will be permanently removed, including from every article that carries it. This cannot
        be undone.
      </p>
      {error ? <p className="mt-3 text-sm text-[var(--red)]">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="rounded-[var(--radius-button)] bg-[var(--red)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Dialog>
  );
}

// canUse/canDelete here only ever gate bulk-apply/bulk-remove on articles for the granted
// group (see userTag.routes.ts's assertCanUseOrRemoveTag) — never rights over the tag entity
// itself, which stays owner-group/org-admin only regardless of any grant made here.
function ShareDialog({
  tag,
  groupOptions,
  onClose,
  onShared,
}: {
  tag: UserTag;
  groupOptions: { id: string; name: string }[];
  onClose: () => void;
  onShared: () => void;
}) {
  const existingByGroupId = new Map(tag.sharedWithGroups.map((grant) => [grant.groupId as string, grant]));
  const shareableGroups = groupOptions.filter(
    (group) => group.id !== tag.ownerGroupId && !existingByGroupId.has(group.id),
  );

  const [drafts, setDrafts] = useState<Record<string, { canUse: boolean; canDelete: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  function updateDraft(groupId: string, patch: Partial<{ canUse: boolean; canDelete: boolean }>) {
    setDrafts((current) => ({
      ...current,
      [groupId]: { canUse: false, canDelete: false, ...current[groupId], ...patch },
    }));
  }

  const hasSelection = Object.values(drafts).some((draft) => draft.canUse || draft.canDelete);

  const shareMutation = useMutation({
    mutationFn: () => {
      const grants = Object.entries(drafts)
        .filter(([, draft]) => draft.canUse || draft.canDelete)
        .map(([groupId, draft]) => ({ groupId, canUse: draft.canUse, canDelete: draft.canDelete }));
      return shareUserTag(tag.id, { grants });
    },
    onSuccess: () => {
      onShared();
      toast.success('Sharing updated.');
      setDrafts({});
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to update sharing.')),
  });

  const revokeMutation = useMutation({
    mutationFn: (groupId: string) => revokeUserTagShare(tag.id, groupId),
    onSuccess: () => {
      onShared();
      toast.success('Share removed.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to remove this share.')),
  });

  return (
    <Dialog title={`Share "${tag.name}"`} onClose={onClose} widthClassName="max-w-md">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-[var(--text-secondary)]">Currently shared with</p>
          {tag.sharedWithGroups.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">Not shared into any other groups yet.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {tag.sharedWithGroups.map((grant) => (
                <li
                  key={grant.groupId}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-input)] border border-[var(--border)] px-2.5 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{grant.groupName}</span>
                  <span className="shrink-0 text-xs text-[var(--text-muted)]">
                    {[grant.canUse ? 'Can use' : null, grant.canDelete ? 'Can delete' : null]
                      .filter(Boolean)
                      .join(' · ') || 'No access'}
                  </span>
                  <button
                    type="button"
                    onClick={() => revokeMutation.mutate(grant.groupId)}
                    disabled={revokeMutation.isPending}
                    aria-label={`Stop sharing with ${grant.groupName}`}
                    className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--red)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-[var(--text-secondary)]">Share with more groups</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            &quot;Can use&quot; lets that group&apos;s members attach this tag to articles; &quot;Can delete&quot; lets
            them remove it. Neither grants rights over the tag itself.
          </p>
          {shareableGroups.length === 0 ? (
            <p className="mt-1.5 text-sm text-[var(--text-muted)]">No other groups available.</p>
          ) : (
            <div className="mt-1.5 max-h-48 space-y-1 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] p-2">
              {shareableGroups.map((group) => {
                const draft = drafts[group.id] ?? { canUse: false, canDelete: false };
                return (
                  <div
                    key={group.id}
                    className="flex items-center justify-between gap-2 py-0.5 text-sm text-[var(--text-secondary)]"
                  >
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <div className="flex shrink-0 items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={draft.canUse}
                          onChange={(event) => updateDraft(group.id, { canUse: event.target.checked })}
                          className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                        />
                        Use
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={draft.canDelete}
                          onChange={(event) => updateDraft(group.id, { canDelete: event.target.checked })}
                          className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                        />
                        Delete
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              shareMutation.mutate();
            }}
            disabled={!hasSelection || shareMutation.isPending}
            className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {shareMutation.isPending ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function SkeletonRow() {
  return (
    <li className="space-y-2 border-b border-[var(--border)] px-4 py-4 last:border-b-0">
      <div className="h-4 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-3 w-56 animate-pulse rounded bg-[var(--bg-hover)]" />
    </li>
  );
}

export default function TagsPage() {
  const { user, permissions } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [isPrivateDraft, setIsPrivateDraft] = useState(false);
  const [renaming, setRenaming] = useState<UserTag | null>(null);
  const [sharing, setSharing] = useState<UserTag | null>(null);
  const [deleting, setDeleting] = useState<UserTag | null>(null);

  const tagsQuery = useQuery({ queryKey: ['user-tags'], queryFn: fetchUserTags });
  const tags = tagsQuery.data ?? [];

  // Shares its cache with SavedQueriesModal's identical 'groups-options' query and
  // GroupDetailPage/AddMemberModal's identical 'roles' query — used here to resolve each
  // tag's owner-group membership for hasScopedPermission, the same scoped-permission model
  // those admin-ish pages already use.
  const groupsQuery = useQuery({ queryKey: ['groups-options'], queryFn: () => fetchGroups(), staleTime: 5 * 60_000 });
  const groups = groupsQuery.data?.items ?? [];
  const groupOptions = groups.map((group) => ({ id: group.id as string, name: group.name }));

  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const roles = rolesQuery.data ?? [];

  // Same key ArticlesPage uses for its own "current group" lookup — resolves the caller's
  // navbar group reliably (not subject to groups-options' pagination) for both display and
  // the create-form's permission check.
  const currentGroupId = user?.currentGroupId ?? null;
  const currentGroupQuery = useQuery({
    queryKey: ['current-group-detail', currentGroupId],
    queryFn: () => {
      if (!currentGroupId) {
        throw new Error('No current group selected.');
      }
      return fetchGroup(currentGroupId);
    },
    enabled: currentGroupId !== null,
  });

  function groupById(id: string) {
    return groups.find((group) => group.id === id);
  }

  // Mirrors GroupDetailPage's hasScopedPermission usage: an org-wide holder of `permission`
  // passes regardless of whether the owner group is resolvable; a scoped-only holder (e.g. a
  // Group Admin whose grant lives on GroupMember.roleId, not the JWT's org-wide permissions)
  // needs that specific group's membership checked.
  function hasTagPermission(tag: UserTag, permission: Permission): boolean {
    if (!user) return false;
    const group = groupById(tag.ownerGroupId) ?? { members: [] };
    return hasScopedPermission(group, roles, user.id, permissions, permission);
  }

  const canCreateTag =
    currentGroupId !== null &&
    user !== null &&
    hasScopedPermission(currentGroupQuery.data ?? { members: [] }, roles, user.id, permissions, 'user-tags:manage');

  function invalidateTags() {
    void queryClient.invalidateQueries({ queryKey: ['user-tags'] });
  }

  const createMutation = useMutation({
    mutationFn: createUserTag,
    onSuccess: () => {
      invalidateTags();
      setName('');
      setIsPrivateDraft(false);
      toast.success('Tag created.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to create tag.')),
  });

  const privacyMutation = useMutation({
    mutationFn: ({ id, isPrivate }: { id: string; isPrivate: boolean }) => updateUserTag(id, { isPrivate }),
    onSuccess: (updated) => {
      invalidateTags();
      toast.success(updated.isPrivate ? 'Tag is now private.' : 'Tag is now public.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to update visibility.')),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => publishUserTag(id),
    onSuccess: () => {
      invalidateTags();
      toast.success('Tag published.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to publish tag.')),
  });

  function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({ name: trimmed, isPrivate: isPrivateDraft });
  }

  function handleDeleted() {
    invalidateTags();
    // A deleted tag is actively stripped from every Article server-side (see
    // userTag.routes.ts's DELETE /:id) — invalidate the caches that display tag membership so
    // they don't keep showing a since-removed tag until their own next refetch.
    void queryClient.invalidateQueries({ queryKey: ['articles-search'] });
    void queryClient.invalidateQueries({ queryKey: ['article'] });
  }

  const showEmptyState = !tagsQuery.isLoading && !tagsQuery.isError && tags.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Tags</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Organize articles with tags. Public tags are visible and usable org-wide; private tags are visible only to
        their owner group unless explicitly shared into others.
      </p>

      {currentGroupId === null ? (
        <p className="mt-6 text-sm text-[var(--text-secondary)]">
          Select a current group from{' '}
          <Link to="/articles" className="text-[var(--accent)] hover:underline">
            Articles
          </Link>{' '}
          before creating tags.
        </p>
      ) : canCreateTag ? (
        <form
          onSubmit={handleCreateSubmit}
          className="mt-6 space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-4"
        >
          <p className="text-xs text-[var(--text-secondary)]">
            Creating in:{' '}
            <span className="font-medium text-[var(--text-primary)]">
              {currentGroupQuery.data?.name ?? '…'}
            </span>
          </p>

          <div>
            <label htmlFor="tag-name" className="block text-xs text-[var(--text-secondary)]">
              Name
            </label>
            <input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={USER_TAG_NAME_MAX_LENGTH}
              className={`mt-1 ${INPUT_CLASSNAME}`}
              placeholder="e.g. earnings-call"
              required
            />
            <p className="mt-1 text-right text-xs text-[var(--text-muted)]">
              {name.length}/{USER_TAG_NAME_MAX_LENGTH}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Toggle checked={isPrivateDraft} onChange={setIsPrivateDraft} label="Make this tag private" />
            <span className="text-sm text-[var(--text-primary)]">{isPrivateDraft ? 'Private' : 'Public'}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {isPrivateDraft
              ? 'Only members of your current group will be able to see or use this tag, unless it is shared into other groups.'
              : 'Every member of your organization will be able to see and use this tag.'}
          </p>

          <button
            type="submit"
            disabled={createMutation.isPending || !name.trim()}
            className="h-9 rounded-[var(--radius-button)] bg-[var(--accent)] px-4 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {createMutation.isPending ? 'Creating…' : 'Create tag'}
          </button>
        </form>
      ) : null}

      {tagsQuery.isError ? (
        <p className="mt-6 text-sm text-[var(--red)]">{getApiErrorMessage(tagsQuery.error, 'Unable to load tags.')}</p>
      ) : null}

      <div className="mt-6">
        {tagsQuery.isLoading ? (
          <ul className="rounded-[var(--radius-card)] border border-[var(--border)]">
            {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
              <SkeletonRow key={index} />
            ))}
          </ul>
        ) : showEmptyState ? (
          <EmptyState
            icon={TagIcon}
            title="No tags yet"
            description={canCreateTag ? 'Create a tag to start organizing articles.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-card)] border border-[var(--border)]">
            {tags.map((tag) => {
              const canManage = hasTagPermission(tag, 'user-tags:manage');
              const canPublish = hasTagPermission(tag, 'user-tags:publish');
              const canShare = hasTagPermission(tag, 'user-tags:shareIntoGroups');
              const isTogglingThis =
                privacyMutation.isPending && privacyMutation.variables?.id === tag.id;
              const isPublishingThis = publishMutation.isPending && publishMutation.variables === tag.id;

              return (
                <li key={tag.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {tag.isPrivate ? (
                        <Lock size={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                      ) : (
                        <Globe size={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                      )}
                      <span className="font-medium text-[var(--text-primary)]">{tag.name}</span>
                      {tag.isPublished ? (
                        <span className="flex items-center gap-1 rounded-full bg-[var(--green)]/15 px-2 py-0.5 text-xs font-medium text-[var(--green)]">
                          <BadgeCheck size={11} />
                          Published
                        </span>
                      ) : null}
                      <span className="text-xs text-[var(--text-muted)]">
                        {tag.articleCount} article{tag.articleCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--text-secondary)]">
                      Owner group: <span className="text-[var(--text-primary)]">{tag.ownerGroupName}</span>
                    </p>

                    {canManage ? (
                      <div className={isTogglingThis ? 'pointer-events-none opacity-60' : undefined}>
                        <div className="flex items-center gap-2">
                          <Toggle
                            checked={tag.isPrivate}
                            onChange={(next) => privacyMutation.mutate({ id: tag.id, isPrivate: next })}
                            label={`Make "${tag.name}" ${tag.isPrivate ? 'public' : 'private'}`}
                          />
                          <span className="text-sm text-[var(--text-primary)]">
                            {tag.isPrivate ? 'Private' : 'Public'}
                          </span>
                        </div>
                      </div>
                    ) : null}
                    <p className="text-xs text-[var(--text-muted)]">
                      {tag.isPrivate
                        ? `Only members of ${tag.ownerGroupName} can see or use this tag, unless shared into other groups below.`
                        : 'Visible and usable by everyone in the organization.'}
                    </p>

                    {tag.sharedWithGroups.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {tag.sharedWithGroups.map((grant) => (
                          <span
                            key={grant.groupId}
                            className="rounded-[var(--radius-tag)] px-2 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                          >
                            {grant.groupName}
                            {' · '}
                            {[grant.canUse ? 'Use' : null, grant.canDelete ? 'Delete' : null]
                              .filter(Boolean)
                              .join('/') || 'No access'}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => setRenaming(tag)}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        Rename
                      </button>
                    ) : null}
                    {canShare ? (
                      <button
                        type="button"
                        onClick={() => setSharing(tag)}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        Share
                      </button>
                    ) : null}
                    {canPublish && !tag.isPublished ? (
                      <button
                        type="button"
                        onClick={() => publishMutation.mutate(tag.id)}
                        disabled={isPublishingThis}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isPublishingThis ? 'Publishing…' : 'Publish'}
                      </button>
                    ) : null}
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => setDeleting(tag)}
                        className="text-[var(--red)] hover:underline"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {renaming ? (
        <RenameDialog tag={renaming} onClose={() => setRenaming(null)} onRenamed={invalidateTags} />
      ) : null}
      {sharing ? (
        <ShareDialog
          tag={sharing}
          groupOptions={groupOptions}
          onClose={() => setSharing(null)}
          onShared={invalidateTags}
        />
      ) : null}
      {deleting ? (
        <DeleteConfirmDialog tag={deleting} onClose={() => setDeleting(null)} onDeleted={handleDeleted} />
      ) : null}
    </div>
  );
}
