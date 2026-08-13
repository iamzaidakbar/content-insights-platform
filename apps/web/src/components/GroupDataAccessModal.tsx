import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import type { Concept, Group, HardFilterGrant, Project, SoftFilterConceptGrant } from '@content-insights/shared';

import { getApiErrorMessage } from '../lib/api-client';
import { INPUT_CLASSNAME } from '../lib/form-styles';
import { fetchConcepts, fetchConceptValues } from '../lib/concepts-api';
import {
  clearGroupDefaultQuery,
  fetchGroupDefaultQueries,
  setGroupDefaultQuery,
  updateGroupHardFilters,
  updateGroupProjects,
  updateGroupSoftFilters,
} from '../lib/groups-api';
import { fetchAllProjects } from '../lib/projects-api';
import { fetchSavedSearches } from '../lib/saved-searches-api';
import { SETTINGS_SELECT_CLASSNAME } from './settings/SettingsSection';
import Modal from './ui/Modal';

// ---------------------------------------------------------------------------------------
// The Data Access modal is the UI for GroupDataAccess (packages/shared/src/types/group.ts)
// — the core of this app's security model: which projects a group may see at all, which
// values of a "hard" concept it's allowed to see/filter by (values not listed are withheld
// entirely, not just hidden from the filter panel), which "soft" concepts show up in its
// members' filter panel and in what order, and which saved search each project lands on by
// default. Each of the four tabs below is its own PUT sub-resource server-side
// (group.routes.ts) — edits are staged locally per tab and committed with an explicit Save,
// mirroring those endpoints' full-array-replace semantics (there's no per-item PATCH).
// ---------------------------------------------------------------------------------------

type TabKey = 'projects' | 'hard' | 'soft' | 'default';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'projects', label: 'Projects' },
  { key: 'hard', label: 'Hard Filter Values' },
  { key: 'soft', label: 'Soft Filter Concepts' },
  { key: 'default', label: 'Default Query' },
];

function ProjectsTab({ group, onSaved }: { group: Group; onSaved: (updated: Group) => void }) {
  const projectsQuery = useQuery({ queryKey: ['projects-all'], queryFn: fetchAllProjects });
  const projects = projectsQuery.data ?? [];
  const [selected, setSelected] = useState<Set<string>>(() => new Set(group.dataAccess.projectIds));
  const [filter, setFilter] = useState('');

  const saveMutation = useMutation({
    mutationFn: () => updateGroupProjects(group.id, Array.from(selected)),
    onSuccess: (updated) => {
      onSaved(updated);
      toast.success('Projects updated.');
    },
  });

  const visible = projects.filter((project) => project.name.toLowerCase().includes(filter.trim().toLowerCase()));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Projects this group's members may access. Membership in this group is what grants project visibility at
        all — everything else in this modal only narrows what's visible within a granted project.
      </p>
      {projectsQuery.isError ? (
        <p className="text-sm text-[var(--red)]">{getApiErrorMessage(projectsQuery.error, 'Unable to load projects.')}</p>
      ) : null}

      <input
        type="text"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter projects…"
        className={INPUT_CLASSNAME}
      />

      <div className="max-h-64 space-y-1 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] p-2">
        {projectsQuery.isLoading ? (
          <p className="p-2 text-xs text-[var(--text-muted)]">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="p-2 text-xs text-[var(--text-muted)]">No projects found.</p>
        ) : (
          visible.map((project) => (
            <label
              key={project.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <input
                type="checkbox"
                checked={selected.has(project.id)}
                onChange={() => toggle(project.id)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
              />
              {project.name}
            </label>
          ))
        )}
      </div>

      <div className="flex justify-end border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save projects'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Hard Filter Values
// ---------------------------------------------------------------------------------------

interface PendingHardGrant {
  conceptId: string;
  conceptName: string;
  allowedValues: string[];
  denialNote?: string;
}

function toPendingHardGrant(grant: HardFilterGrant): PendingHardGrant {
  return {
    conceptId: grant.conceptId,
    conceptName: grant.conceptName,
    allowedValues: grant.allowedValues,
    ...(grant.denialNote !== undefined ? { denialNote: grant.denialNote } : {}),
  };
}

function HardGrantForm({
  projectOptions,
  existing,
  existingConceptIds,
  onCancel,
  onSubmit,
}: {
  projectOptions: Project[];
  existing?: PendingHardGrant;
  existingConceptIds: string[];
  onCancel: () => void;
  onSubmit: (grant: PendingHardGrant) => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [conceptId, setConceptId] = useState(existing?.conceptId ?? '');
  const [conceptName, setConceptName] = useState(existing?.conceptName ?? '');
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set(existing?.allowedValues ?? []));
  const [denialNote, setDenialNote] = useState(existing?.denialNote ?? '');

  const conceptsQuery = useQuery({
    queryKey: ['concepts', projectId],
    queryFn: () => fetchConcepts(projectId),
    enabled: !existing && projectId.length > 0,
  });
  const hardConcepts = (conceptsQuery.data ?? []).filter(
    (concept) => concept.placement === 'hard' && !existingConceptIds.includes(concept.id),
  );

  const valuesQuery = useQuery({
    queryKey: ['concept-values', conceptId],
    queryFn: () => fetchConceptValues(conceptId),
    enabled: conceptId.length > 0,
  });
  const values = valuesQuery.data ?? [];

  function toggleValue(value: string) {
    setSelectedValues((current) => {
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  function handleSubmit() {
    if (!conceptId || !conceptName) {
      return;
    }
    onSubmit({
      conceptId,
      conceptName,
      allowedValues: Array.from(selectedValues),
      ...(denialNote.trim() ? { denialNote: denialNote.trim() } : {}),
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-input)] border border-[var(--border)] p-3">
      {existing ? (
        <p className="text-sm text-[var(--text-primary)]">
          Concept: <span className="font-medium">{existing.conceptName}</span>
        </p>
      ) : (
        <>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">Project</label>
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setConceptId('');
                setConceptName('');
              }}
              className={`mt-1 w-full ${SETTINGS_SELECT_CLASSNAME}`}
            >
              <option value="">Select a project…</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">Concept (hard filter)</label>
            <select
              value={conceptId}
              disabled={!projectId}
              onChange={(event) => {
                const nextId = event.target.value;
                setConceptId(nextId);
                const concept = hardConcepts.find((candidate) => candidate.id === nextId);
                setConceptName(concept ? concept.displayLabel || concept.name : '');
              }}
              className={`mt-1 w-full ${SETTINGS_SELECT_CLASSNAME} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <option value="">{projectId ? 'Select a concept…' : 'Select a project first'}</option>
              {hardConcepts.map((concept) => (
                <option key={concept.id} value={concept.id}>
                  {concept.displayLabel || concept.name}
                </option>
              ))}
            </select>
            {projectId && !conceptsQuery.isLoading && hardConcepts.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                No available hard-filter concepts in this project.
              </p>
            ) : null}
          </div>
        </>
      )}

      {conceptId ? (
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)]">Allowed values</label>
          {valuesQuery.isLoading ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">Loading values…</p>
          ) : values.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">No indexed values for this concept yet.</p>
          ) : (
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] p-2">
              {values.map((bucket) => (
                <label
                  key={bucket.key}
                  className="flex cursor-pointer items-center justify-between gap-2 text-sm text-[var(--text-secondary)]"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedValues.has(bucket.key)}
                      onChange={() => toggleValue(bucket.key)}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                    />
                    {bucket.key}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">{bucket.count}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)]">
          Denial note <span className="text-[var(--text-muted)]">(optional — explains withheld values)</span>
        </label>
        <textarea
          value={denialNote}
          onChange={(event) => setDenialNote(event.target.value)}
          maxLength={500}
          rows={2}
          className={`mt-1 w-full ${INPUT_CLASSNAME}`}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!conceptId}
          className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {existing ? 'Update grant' : 'Add grant'}
        </button>
      </div>
    </div>
  );
}

function HardFiltersTab({
  group,
  grantedProjects,
  allProjects,
  onSaved,
}: {
  group: Group;
  grantedProjects: Project[];
  allProjects: Project[];
  onSaved: (updated: Group) => void;
}) {
  const [pending, setPending] = useState<PendingHardGrant[]>(() =>
    group.dataAccess.hardFilterGrants.map(toPendingHardGrant),
  );
  const [formMode, setFormMode] = useState<'closed' | 'add' | string>('closed');

  // Falls back to every org project if this group hasn't been granted any yet, rather than
  // blocking the picker outright — an admin may reasonably want to stage hard filter values
  // before saving the Projects tab.
  const projectOptions = grantedProjects.length > 0 ? grantedProjects : allProjects;

  const saveMutation = useMutation({
    mutationFn: () => updateGroupHardFilters(group.id, pending),
    onSuccess: (updated) => {
      onSaved(updated);
      toast.success('Hard filter values saved.');
    },
  });

  function handleFormSubmit(grant: PendingHardGrant) {
    setPending((current) => {
      const exists = current.some((entry) => entry.conceptId === grant.conceptId);
      return exists
        ? current.map((entry) => (entry.conceptId === grant.conceptId ? grant : entry))
        : [...current, grant];
    });
    setFormMode('closed');
  }

  function removeGrant(conceptId: string) {
    setPending((current) => current.filter((entry) => entry.conceptId !== conceptId));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Restrict which values of a hard-placement concept this group's members can see or filter by at all — values
        left unchecked are withheld entirely, not merely hidden from the filter panel. An optional note can explain
        why values were withheld.
      </p>
      {projectOptions.length === 0 ? (
        <p className="text-xs text-[var(--amber)]">No projects available yet — grant this group a project first.</p>
      ) : grantedProjects.length === 0 ? (
        <p className="text-xs text-[var(--amber)]">
          This group has no granted projects yet — showing every org project below; save the Projects tab first for
          a scoped picker.
        </p>
      ) : null}

      <div className="space-y-2">
        {pending.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No hard filter grants configured.</p>
        ) : (
          pending.map((grant) =>
            formMode === grant.conceptId ? (
              <HardGrantForm
                key={grant.conceptId}
                projectOptions={projectOptions}
                existing={grant}
                existingConceptIds={pending.map((entry) => entry.conceptId)}
                onCancel={() => setFormMode('closed')}
                onSubmit={handleFormSubmit}
              />
            ) : (
              <div
                key={grant.conceptId}
                className="flex items-center justify-between rounded-[var(--radius-input)] border border-[var(--border)] p-3 text-sm"
              >
                <div>
                  <p className="font-medium text-[var(--text-primary)]">{grant.conceptName}</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {grant.allowedValues.length} allowed value{grant.allowedValues.length === 1 ? '' : 's'}
                    {grant.denialNote ? ` · “${grant.denialNote}”` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setFormMode(grant.conceptId)}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeGrant(grant.conceptId)}
                    className="text-[var(--red)] hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ),
          )
        )}
      </div>

      {formMode === 'add' ? (
        <HardGrantForm
          projectOptions={projectOptions}
          existingConceptIds={pending.map((entry) => entry.conceptId)}
          onCancel={() => setFormMode('closed')}
          onSubmit={handleFormSubmit}
        />
      ) : (
        <button
          type="button"
          onClick={() => setFormMode('add')}
          disabled={projectOptions.length === 0}
          className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Add hard filter grant
        </button>
      )}

      <div className="flex justify-end border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save hard filter values'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Soft Filter Concepts
// ---------------------------------------------------------------------------------------

interface PendingSoftGrant {
  conceptId: string;
  conceptName: string;
}

function SoftFiltersTab({
  group,
  grantedProjects,
  onSaved,
}: {
  group: Group;
  grantedProjects: Project[];
  onSaved: (updated: Group) => void;
}) {
  const [pending, setPending] = useState<PendingSoftGrant[]>(() =>
    [...group.dataAccess.softFilterConcepts]
      .sort((a: SoftFilterConceptGrant, b: SoftFilterConceptGrant) => a.order - b.order)
      .map((entry) => ({ conceptId: entry.conceptId, conceptName: entry.conceptName })),
  );

  const grantedProjectIds = grantedProjects.map((project) => project.id).join(',');
  const softConceptsQuery = useQuery({
    queryKey: ['soft-concepts', group.id, grantedProjectIds],
    queryFn: async () => {
      const perProject = await Promise.all(grantedProjects.map((project) => fetchConcepts(project.id)));
      return perProject.flat().filter((concept) => concept.placement === 'soft');
    },
    enabled: grantedProjects.length > 0,
  });
  const availableConcepts = (softConceptsQuery.data ?? []).filter(
    (concept) => !pending.some((entry) => entry.conceptId === concept.id),
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      updateGroupSoftFilters(
        group.id,
        pending.map((entry, index) => ({ conceptId: entry.conceptId, conceptName: entry.conceptName, order: index })),
      ),
    onSuccess: (updated) => {
      onSaved(updated);
      toast.success('Soft filter concepts saved.');
    },
  });

  function addConcept(concept: Concept) {
    setPending((current) => [...current, { conceptId: concept.id, conceptName: concept.displayLabel || concept.name }]);
  }
  function removeConcept(conceptId: string) {
    setPending((current) => current.filter((entry) => entry.conceptId !== conceptId));
  }
  function move(index: number, direction: -1 | 1) {
    setPending((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const a = current[index];
      const b = current[target];
      if (!a || !b) {
        return current;
      }
      const next = [...current];
      next[index] = b;
      next[target] = a;
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Choose which soft-placement concepts this group's members see in their filter panel, and the order they
        appear in — use the arrows to reorder.
      </p>
      {grantedProjects.length === 0 ? (
        <p className="text-xs text-[var(--amber)]">No granted projects yet — save the Projects tab first.</p>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Available</p>
          <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] p-2">
            {softConceptsQuery.isLoading ? (
              <p className="p-1 text-xs text-[var(--text-muted)]">Loading…</p>
            ) : availableConcepts.length === 0 ? (
              <p className="p-1 text-xs text-[var(--text-muted)]">Nothing available.</p>
            ) : (
              availableConcepts.map((concept) => (
                <button
                  key={concept.id}
                  type="button"
                  onClick={() => addConcept(concept)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  {concept.displayLabel || concept.name}
                  <Plus size={13} />
                </button>
              ))
            )}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Selected &amp; ordered</p>
          <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] p-2">
            {pending.length === 0 ? (
              <p className="p-1 text-xs text-[var(--text-muted)]">None selected.</p>
            ) : (
              pending.map((concept, index) => (
                <div
                  key={concept.conceptId}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm text-[var(--text-secondary)]"
                >
                  <span>{concept.conceptName}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === pending.length - 1}
                      aria-label="Move down"
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeConcept(concept.conceptId)}
                      aria-label="Remove"
                      className="text-[var(--text-muted)] hover:text-[var(--red)]"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save soft filter concepts'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Default Query
// ---------------------------------------------------------------------------------------

function DefaultQueryTab({ group, grantedProjects }: { group: Group; grantedProjects: Project[] }) {
  const queryClient = useQueryClient();
  const savedSearchesQuery = useQuery({
    queryKey: ['saved-searches-for-group', group.id],
    queryFn: () => fetchSavedSearches('mine', group.id, 1),
  });
  const searches = savedSearchesQuery.data?.items ?? [];

  const defaultsQuery = useQuery({
    queryKey: ['group-default-queries', group.id],
    queryFn: () => fetchGroupDefaultQueries(group.id),
  });
  const defaultsByProject = new Map(
    (defaultsQuery.data ?? []).map((entry) => [entry.projectId, entry]),
  );

  const [selectedByProject, setSelectedByProject] = useState<Record<string, string>>({});

  const setMutation = useMutation({
    mutationFn: (variables: { projectId: string; savedSearchId: string }) =>
      setGroupDefaultQuery(group.id, variables),
    onSuccess: (result, variables) => {
      setSelectedByProject((current) => ({
        ...current,
        [variables.projectId]: result?.savedSearchId ?? '',
      }));
      void queryClient.invalidateQueries({ queryKey: ['group-default-queries', group.id] });
      toast.success('Default query set.');
    },
  });

  const clearMutation = useMutation({
    mutationFn: (projectId: string) => clearGroupDefaultQuery(group.id, projectId),
    onSuccess: (_result, projectId) => {
      setSelectedByProject((current) => ({ ...current, [projectId]: '' }));
      void queryClient.invalidateQueries({ queryKey: ['group-default-queries', group.id] });
      toast.success('Default query cleared.');
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Pick the saved search each project should land on for this group's members. This screen only shows saved
        searches already visible to this group (owned within it, shared into it, or admin-tier) — share a search
        into this group first (Saved Searches) to use it as a default here.
      </p>
      {savedSearchesQuery.isError || defaultsQuery.isError ? (
        <p className="text-xs text-[var(--red)]">
          {getApiErrorMessage(
            savedSearchesQuery.error ?? defaultsQuery.error,
            'Unable to load default queries.',
          )}
        </p>
      ) : null}
      {grantedProjects.length === 0 ? (
        <p className="text-xs text-[var(--amber)]">No granted projects yet — save the Projects tab first.</p>
      ) : null}

      <div className="space-y-3">
        {grantedProjects.map((project) => {
          const existing = defaultsByProject.get(project.id);
          const selected = selectedByProject[project.id] ?? existing?.savedSearchId ?? '';
          return (
            <div key={project.id} className="rounded-[var(--radius-input)] border border-[var(--border)] p-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">{project.name}</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {existing
                  ? `Current default: ${existing.savedSearchName}`
                  : 'No default query configured'}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={selected}
                  onChange={(event) =>
                    setSelectedByProject((current) => ({ ...current, [project.id]: event.target.value }))
                  }
                  className={`flex-1 ${SETTINGS_SELECT_CLASSNAME}`}
                >
                  <option value="">Select a saved search…</option>
                  {searches.map((search) => (
                    <option key={search.id} value={search.id}>
                      {search.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selected || setMutation.isPending}
                  onClick={() => setMutation.mutate({ projectId: project.id, savedSearchId: selected })}
                  className="rounded-[var(--radius-button)] bg-[var(--accent)] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Set
                </button>
                <button
                  type="button"
                  disabled={clearMutation.isPending}
                  onClick={() => clearMutation.mutate(project.id)}
                  className="rounded-[var(--radius-button)] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------------------

export default function GroupDataAccessModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('projects');
  const [liveGroup, setLiveGroup] = useState(group);

  const allProjectsQuery = useQuery({ queryKey: ['projects-all'], queryFn: fetchAllProjects });
  const allProjects = allProjectsQuery.data ?? [];
  const grantedProjects = allProjects.filter((project) => liveGroup.dataAccess.projectIds.includes(project.id));

  function handleSaved(updated: Group) {
    setLiveGroup(updated);
    queryClient.setQueryData(['group', group.id], updated);
    void queryClient.invalidateQueries({ queryKey: ['groups-list'] });
  }

  return (
    <Modal open onClose={onClose} title="Data access" description={liveGroup.name} size="xl" scrollable>
      <div className="-mx-5 -mt-4 mb-4 flex gap-1 border-b border-[var(--border)] px-5">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-t-[var(--radius-button)] px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === item.key
                ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* All four tabs stay mounted (CSS-hidden, not unmounted) so an in-progress, unsaved
          edit in one (e.g. a staged hard-filter grant) survives switching tabs and back —
          same convention as AdminPage/SettingsPage's own sub-nav. */}
      <div className={tab === 'projects' ? '' : 'hidden'}>
        <ProjectsTab group={liveGroup} onSaved={handleSaved} />
      </div>
      <div className={tab === 'hard' ? '' : 'hidden'}>
        <HardFiltersTab
          group={liveGroup}
          grantedProjects={grantedProjects}
          allProjects={allProjects}
          onSaved={handleSaved}
        />
      </div>
      <div className={tab === 'soft' ? '' : 'hidden'}>
        <SoftFiltersTab group={liveGroup} grantedProjects={grantedProjects} onSaved={handleSaved} />
      </div>
      <div className={tab === 'default' ? '' : 'hidden'}>
        <DefaultQueryTab group={liveGroup} grantedProjects={grantedProjects} />
      </div>
    </Modal>
  );
}
