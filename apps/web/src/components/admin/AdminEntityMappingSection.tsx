import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';

import {
  UPSTREAM_ENTITY_TYPES,
  type EntityMapping,
  type EntityMappingEntry,
  type EntityMappingStatus,
  type UpstreamEntityType,
} from '@content-insights/shared';

import { useAuth } from '../../auth/AuthContext';
import { getApiErrorMessage } from '../../lib/api-client';
import { fetchConcepts } from '../../lib/concepts-api';
import { fetchEntityMapping, mapEntityMappingEntry, syncEntityMapping } from '../../lib/entity-mapping-api';
import { formatDate } from '../../lib/format';
import { fetchProjects } from '../../lib/projects-api';
import EmptyState from '../EmptyState';
import { SETTINGS_SELECT_CLASSNAME, SettingsSection } from '../settings/SettingsSection';

const ENTITY_TYPE_LABELS: Record<UpstreamEntityType, string> = {
  project: 'Project',
  concept: 'Concept',
  source: 'Source',
};

const STATUS_STYLES: Record<EntityMappingStatus, string> = {
  unmapped: 'border border-[var(--amber)] text-[var(--amber)]',
  mapped: 'border border-[var(--green)] text-[var(--green)]',
  conflict: 'border border-[var(--red)] text-[var(--red)]',
};

const STATUS_LABELS: Record<EntityMappingStatus, string> = {
  unmapped: 'Unmapped',
  mapped: 'Mapped',
  conflict: 'Conflict',
};

function StatusPill({ status }: { status: EntityMappingStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------------------
// MapEntryEditor — the inline row form used to (re)map one entry to a local Project,
// Concept, or Source. Concepts are scoped to a project (concepts-api.ts's fetchConcepts
// requires a projectId), so mapping to a concept is a two-step pick: project, then concept
// within it. Mapping to a 'source' just takes the literal domain string, per
// entityMapping.routes.ts's resolveLocalName — a source has no dedicated model to look up.
// ---------------------------------------------------------------------------------------
function MapEntryEditor({
  entry,
  onCancel,
  onSaved,
}: {
  entry: EntityMappingEntry;
  onCancel: () => void;
  onSaved: (updated: EntityMapping) => void;
}) {
  const [localType, setLocalType] = useState<UpstreamEntityType>(entry.localType);
  const [projectId, setProjectId] = useState(entry.localType === 'project' ? (entry.localId ?? '') : '');
  const [conceptId, setConceptId] = useState(entry.localType === 'concept' ? (entry.localId ?? '') : '');
  const [sourceId, setSourceId] = useState(entry.localType === 'source' ? (entry.localId ?? '') : '');

  const projectsQuery = useQuery({ queryKey: ['projects-options'], queryFn: () => fetchProjects(1), staleTime: 5 * 60_000 });
  const projects = projectsQuery.data?.items ?? [];

  const conceptsQuery = useQuery({
    queryKey: ['concepts-for-project', projectId],
    queryFn: () => fetchConcepts(projectId),
    enabled: localType === 'concept' && projectId.length > 0,
  });
  const concepts = conceptsQuery.data ?? [];

  const mapMutation = useMutation({
    mutationFn: () =>
      mapEntityMappingEntry(entry.id, {
        localType,
        localId: localType === 'project' ? projectId : localType === 'concept' ? conceptId : sourceId.trim(),
      }),
    onSuccess: (updated) => {
      onSaved(updated);
      toast.success('Mapping saved.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to save this mapping.')),
  });

  function handleTypeChange(next: UpstreamEntityType) {
    setLocalType(next);
    setProjectId('');
    setConceptId('');
    setSourceId('');
  }

  const localId = localType === 'project' ? projectId : localType === 'concept' ? conceptId : sourceId.trim();
  const canSave = localId.length > 0 && !mapMutation.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-2.5">
      <select
        value={localType}
        onChange={(event) => handleTypeChange(event.target.value as UpstreamEntityType)}
        className={SETTINGS_SELECT_CLASSNAME}
        aria-label="Local entity type"
      >
        {UPSTREAM_ENTITY_TYPES.map((type) => (
          <option key={type} value={type}>
            {ENTITY_TYPE_LABELS[type]}
          </option>
        ))}
      </select>

      {localType === 'project' ? (
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className={SETTINGS_SELECT_CLASSNAME}
          aria-label="Project"
        >
          <option value="">Select a project…</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      ) : null}

      {localType === 'concept' ? (
        <>
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setConceptId('');
            }}
            className={SETTINGS_SELECT_CLASSNAME}
            aria-label="Project"
          >
            <option value="">Select a project…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            value={conceptId}
            onChange={(event) => setConceptId(event.target.value)}
            className={SETTINGS_SELECT_CLASSNAME}
            aria-label="Concept"
            disabled={!projectId}
          >
            <option value="">{projectId ? 'Select a concept…' : 'Pick a project first'}</option>
            {concepts.map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.displayLabel || concept.name}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {localType === 'source' ? (
        <input
          type="text"
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          placeholder="e.g. reuters.com"
          className="rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-button)] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => mapMutation.mutate()}
          disabled={!canSave}
          className="rounded-[var(--radius-button)] bg-[var(--accent)] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mapMutation.isPending ? 'Saving…' : 'Save mapping'}
        </button>
      </div>
    </div>
  );
}

export default function AdminEntityMappingSection() {
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const canManage = permissions.includes('*') || permissions.includes('entity-mapping:manage');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const mappingQuery = useQuery({ queryKey: ['entity-mapping'], queryFn: fetchEntityMapping });
  const mapping = mappingQuery.data;
  const entries = mapping?.entries ?? [];

  const syncMutation = useMutation({
    mutationFn: syncEntityMapping,
    onSuccess: (updated) => {
      const previousCount = mapping?.entries.length ?? 0;
      queryClient.setQueryData(['entity-mapping'], updated);
      const added = updated.entries.length - previousCount;
      toast.success(added > 0 ? `Sync complete — found ${added} new entr${added === 1 ? 'y' : 'ies'}.` : 'Sync complete — no new entries found.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to sync sources.')),
  });

  const unmapMutation = useMutation({
    mutationFn: (target: EntityMappingEntry) =>
      mapEntityMappingEntry(target.id, { localType: target.localType, localId: null }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['entity-mapping'], updated);
      toast.success('Entry unmapped.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to unmap this entry.')),
  });

  function handleSaved(updated: EntityMapping) {
    queryClient.setQueryData(['entity-mapping'], updated);
    setEditingEntryId(null);
  }

  return (
    <SettingsSection
      title="Entity mapping"
      description="Reconciles upstream sources against this org's local Projects, Concepts, and article domains."
    >
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-3">
        <p className="max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">
          No external content platform is connected in this environment — &quot;Sync&quot; scans this org&apos;s own
          already-ingested Projects, Concepts, and article domains as stand-ins for upstream entities, rather than
          calling a live integration. It never overwrites an existing mapping decision, only adds newly-discovered
          candidates.
        </p>
        {canManage ? (
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : ''} />
            {syncMutation.isPending ? 'Syncing…' : 'Sync sources from index'}
          </button>
        ) : null}
      </div>

      <div className="mt-5">
        {mappingQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="h-11 animate-pulse rounded bg-[var(--bg-hover)]" />
            ))}
          </div>
        ) : mappingQuery.isError ? (
          <p className="text-sm text-[var(--red)]">
            {getApiErrorMessage(mappingQuery.error, 'Unable to load the entity mapping.')}
          </p>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={RefreshCw}
            title="No entries yet"
            description="Run a sync to discover this org's Projects, Concepts, and article sources as mappable entries."
          />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Upstream entity</th>
                  <th className="px-3 py-2.5 font-medium">Mapped to</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Last synced</th>
                  {canManage ? <th className="px-3 py-2.5 font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-[var(--border)] align-top last:border-b-0">
                    <td className="px-3 py-2.5">
                      <p className="text-[var(--text-primary)]">{entry.upstreamName}</p>
                      <p className="text-xs text-[var(--text-muted)]">{ENTITY_TYPE_LABELS[entry.upstreamType]}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      {editingEntryId === entry.id ? null : entry.localId ? (
                        <>
                          <p className="text-[var(--text-primary)]">{entry.localName ?? entry.localId}</p>
                          <p className="text-xs text-[var(--text-muted)]">{ENTITY_TYPE_LABELS[entry.localType]}</p>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">Unmapped</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={entry.status} />
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                      {entry.lastSyncedAt ? formatDate(entry.lastSyncedAt) : '—'}
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2.5">
                        {editingEntryId !== entry.id ? (
                          <div className="flex items-center gap-3 text-xs">
                            <button
                              type="button"
                              onClick={() => setEditingEntryId(entry.id)}
                              className="font-medium text-[var(--accent)] hover:text-[var(--accent-hover)]"
                            >
                              {entry.localId ? 'Change' : 'Map'}
                            </button>
                            {entry.localId ? (
                              <button
                                type="button"
                                onClick={() => unmapMutation.mutate(entry)}
                                disabled={unmapMutation.isPending}
                                className="text-[var(--text-secondary)] hover:text-[var(--red)] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Unmap
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>

            {canManage && editingEntryId ? (
              <div className="border-t border-[var(--border)] p-3">
                {(() => {
                  const editing = entries.find((entry) => entry.id === editingEntryId);
                  return editing ? (
                    <MapEntryEditor entry={editing} onCancel={() => setEditingEntryId(null)} onSaved={handleSaved} />
                  ) : null;
                })()}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {!canManage && !mappingQuery.isLoading && !mappingQuery.isError ? (
        <p className="text-xs text-[var(--text-muted)]">
          You have read-only access to entity mapping. Ask an admin with the entity-mapping:manage permission to sync
          or map entries.
        </p>
      ) : null}
    </SettingsSection>
  );
}
