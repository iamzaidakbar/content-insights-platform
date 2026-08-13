import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { StickyNote, Trash2 } from 'lucide-react';

import type { ArticleNote, ArticleNoteVisibility } from '@content-insights/shared';
import { ARTICLE_NOTE_BODY_MAX_LENGTH } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { getApiErrorMessage } from '../lib/api-client';
import {
  createArticleNote,
  deleteArticleNote,
  fetchArticleNotes,
  updateArticleNote,
} from '../lib/article-notes-api';
import { formatDate } from '../lib/format';
import Badge from './ui/Badge';
import Button from './ui/Button';
import { Card, CardBody, CardTitle } from './ui/Card';
import ConfirmDialog from './ui/ConfirmDialog';
import { Select, Textarea } from './ui/Input';

interface ArticleNotesPanelProps {
  articleId: string;
}

export default function ArticleNotesPanel({ articleId }: ArticleNotesPanelProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['article-notes', articleId];

  const groupOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { id: string; name: string }[] = [];
    for (const assignment of user?.roleAssignments ?? []) {
      if (!assignment.groupId || seen.has(assignment.groupId)) continue;
      seen.add(assignment.groupId);
      options.push({ id: assignment.groupId, name: assignment.groupName ?? 'Group' });
    }
    return options;
  }, [user?.roleAssignments]);

  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<ArticleNoteVisibility>('private');
  const [groupId, setGroupId] = useState(user?.currentGroupId ?? groupOptions[0]?.id ?? '');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const notesQuery = useQuery({
    queryKey,
    queryFn: () => fetchArticleNotes(articleId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createArticleNote(articleId, {
        body: body.trim(),
        visibility,
        ...(visibility === 'group' ? { groupId } : {}),
      }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey });
      toast.success('Note added.');
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to add note.')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ noteId, nextBody }: { noteId: string; nextBody: string }) =>
      updateArticleNote(articleId, noteId, { body: nextBody }),
    onSuccess: () => {
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey });
      toast.success('Note updated.');
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to update note.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteArticleNote(articleId, noteId),
    onSuccess: () => {
      setPendingDeleteId(null);
      void queryClient.invalidateQueries({ queryKey });
      toast.success('Note deleted.');
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to delete note.')),
  });

  const notes = notesQuery.data ?? [];
  const canSubmit =
    body.trim().length > 0 && (visibility === 'private' || Boolean(groupId)) && !createMutation.isPending;

  return (
    <Card>
      <CardBody className="p-4">
        <CardTitle className="flex items-center gap-2">
          <StickyNote size={15} className="text-[var(--text-secondary)]" />
          Notes
        </CardTitle>

        <div className="mt-3 space-y-3">
          {notesQuery.isError ? (
            <p className="text-sm text-[var(--error)]">{getApiErrorMessage(notesQuery.error, 'Unable to load notes.')}</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  isOwn={note.authorId === user?.id}
                  isEditing={editingId === note.id}
                  editBody={editBody}
                  onEditBody={setEditBody}
                  onStartEdit={() => {
                    setEditingId(note.id);
                    setEditBody(note.body);
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={() => updateMutation.mutate({ noteId: note.id, nextBody: editBody.trim() })}
                  savePending={updateMutation.isPending}
                  onDelete={() => setPendingDeleteId(note.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <form
          className="mt-4 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) createMutation.mutate();
          }}
        >
          <Textarea
            aria-label="Note body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={ARTICLE_NOTE_BODY_MAX_LENGTH}
            rows={3}
            placeholder="Add a note…"
          />
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              Visibility
              <Select
                aria-label="Note visibility"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as ArticleNoteVisibility)}
                className="w-auto min-w-[8rem] py-1.5"
              >
                <option value="private">Private</option>
                <option value="group" disabled={groupOptions.length === 0}>
                  Group
                </option>
              </Select>
            </label>
            {visibility === 'group' ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                Group
                <Select
                  aria-label="Note group"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  className="w-auto min-w-[10rem] py-1.5"
                >
                  {groupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <Button type="submit" size="sm" disabled={!canSubmit} loading={createMutation.isPending}>
              Add note
            </Button>
          </div>
        </form>
      </CardBody>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onClose={() => {
          if (!deleteMutation.isPending) setPendingDeleteId(null);
        }}
        onConfirm={() => {
          if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
        }}
        title="Delete this note?"
        description="This note will be removed permanently."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
      />
    </Card>
  );
}

function NoteRow({
  note,
  isOwn,
  isEditing,
  editBody,
  onEditBody,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  savePending,
  onDelete,
}: {
  note: ArticleNote;
  isOwn: boolean;
  isEditing: boolean;
  editBody: string;
  onEditBody: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  savePending: boolean;
  onDelete: () => void;
}) {
  return (
    <li className="rounded-[var(--radius-input)] border border-[var(--border)] px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{note.authorEmail}</p>
          <p className="text-xs text-[var(--text-muted)]">{formatDate(note.createdAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={note.visibility === 'private' ? 'default' : 'accent'}>
            {note.visibility === 'private' ? 'Private' : 'Group'}
          </Badge>
          {isOwn ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onStartEdit}>
                Edit
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label="Delete note" onClick={onDelete}>
                <Trash2 size={14} />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {isEditing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            aria-label="Edit note"
            value={editBody}
            onChange={(event) => onEditBody(event.target.value)}
            maxLength={ARTICLE_NOTE_BODY_MAX_LENGTH}
            rows={3}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={editBody.trim().length === 0} loading={savePending} onClick={onSaveEdit}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-primary)]">{note.body}</p>
      )}
    </li>
  );
}
