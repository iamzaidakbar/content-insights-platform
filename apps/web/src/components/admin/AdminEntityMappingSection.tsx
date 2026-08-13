import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link2, Pencil, RefreshCw, Unlink } from 'lucide-react';

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
import Alert from '../ui/alert';
import { ActionIconButton } from '../ui/action-icon-button';
import Badge from '../ui/badge';
import Button from '../ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '../ui/card';
import { Input, Select } from '../ui/input';
import Skeleton from '../ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../ui/data-table';

const ENTITY_TYPE_LABELS: Record<UpstreamEntityType, string> = {
  project: 'Project',
  concept: 'Concept',
  source: 'Source',
};

const STATUS_VARIANTS: Record<EntityMappingStatus, 'warning' | 'success' | 'error'> = {
  unmapped: 'warning',
  mapped: 'success',
  conflict: 'error',
};

const STATUS_LABELS: Record<EntityMappingStatus, string> = {
  unmapped: 'Unmapped',
  mapped: 'Mapped',
  conflict: 'Conflict',
};

function StatusPill({ status }: { status: EntityMappingStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
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
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2.5">
      <Select
        value={localType}
        onChange={(event) => handleTypeChange(event.target.value as UpstreamEntityType)}
        className="w-auto py-1.5"
        aria-label="Local entity type"
      >
        {UPSTREAM_ENTITY_TYPES.map((type) => (
          <option key={type} value={type}>
            {ENTITY_TYPE_LABELS[type]}
          </option>
        ))}
      </Select>

      {localType === 'project' ? (
        <Select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="w-auto py-1.5"
          aria-label="Project"
        >
          <option value="">Select a project…</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      ) : null}

      {localType === 'concept' ? (
        <>
          <Select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setConceptId('');
            }}
            className="w-auto py-1.5"
            aria-label="Project"
          >
            <option value="">Select a project…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Select
            value={conceptId}
            onChange={(event) => setConceptId(event.target.value)}
            className="w-auto py-1.5"
            aria-label="Concept"
            disabled={!projectId}
          >
            <option value="">{projectId ? 'Select a concept…' : 'Pick a project first'}</option>
            {concepts.map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.displayLabel || concept.name}
              </option>
            ))}
          </Select>
        </>
      ) : null}

      {localType === 'source' ? (
        <Input
          type="text"
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          placeholder="e.g. reuters.com"
          className="w-auto min-w-[12rem] py-1.5"
        />
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => mapMutation.mutate()} disabled={!canSave} loading={mapMutation.isPending}>
          Save mapping
        </Button>
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <Card className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-4">
      <CardHeader className="shrink-0 px-4">
        <CardTitle className="text-base">Entity mapping</CardTitle>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Reconciles upstream sources against this org&apos;s local Projects, Concepts, and article domains.
        </p>
      </CardHeader>
      <CardBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-card p-3">
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            No external content platform is connected in this environment — &quot;Sync&quot; scans this org&apos;s own
            already-ingested Projects, Concepts, and article domains as stand-ins for upstream entities, rather than
            calling a live integration. It never overwrites an existing mapping decision, only adds newly-discovered
            candidates.
          </p>
          {canManage ? (
            <Button
              size="sm"
              leftIcon={<RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : ''} />}
              onClick={() => syncMutation.mutate()}
              loading={syncMutation.isPending}
            >
              Sync sources from index
            </Button>
          ) : null}
        </div>

        {mappingQuery.isLoading ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : mappingQuery.isError ? (
          <Alert variant="error" className="shrink-0">
            {getApiErrorMessage(mappingQuery.error, 'Unable to load the entity mapping.')}
          </Alert>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={RefreshCw}
            title="No entries yet"
            description="Run a sync to discover this org's Projects, Concepts, and article sources as mappable entries."
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <Table scrollable>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Upstream entity</TH>
                  <TH>Mapped to</TH>
                  <TH>Status</TH>
                  <TH>Last synced</TH>
                  {canManage ? <TH>Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <TR key={entry.id} className="align-top">
                    <TD>
                      <p className="text-foreground">{entry.upstreamName}</p>
                      <p className="text-xs text-muted-foreground">{ENTITY_TYPE_LABELS[entry.upstreamType]}</p>
                    </TD>
                    <TD>
                      {editingEntryId === entry.id ? null : entry.localId ? (
                        <>
                          <p className="text-foreground">{entry.localName ?? entry.localId}</p>
                          <p className="text-xs text-muted-foreground">{ENTITY_TYPE_LABELS[entry.localType]}</p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Unmapped</span>
                      )}
                    </TD>
                    <TD>
                      <StatusPill status={entry.status} />
                    </TD>
                    <TD className="text-muted-foreground">
                      {entry.lastSyncedAt ? formatDate(entry.lastSyncedAt) : '—'}
                    </TD>
                    {canManage ? (
                      <TD>
                        {editingEntryId !== entry.id ? (
                          <div className="flex items-center gap-0.5">
                            <ActionIconButton
                              label={entry.localId ? 'Change mapping' : 'Map'}
                              icon={entry.localId ? Pencil : Link2}
                              onClick={() => setEditingEntryId(entry.id)}
                            />
                            {entry.localId ? (
                              <ActionIconButton
                                label="Unmap"
                                icon={Unlink}
                                onClick={() => unmapMutation.mutate(entry)}
                                disabled={unmapMutation.isPending}
                                destructive
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>

            {canManage && editingEntryId ? (
              <div className="shrink-0 overflow-y-auto rounded-lg border border-border p-3">
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
        {!canManage && !mappingQuery.isLoading && !mappingQuery.isError ? (
          <p className="shrink-0 text-xs text-muted-foreground">
            You have read-only access to entity mapping. Ask an admin with the entity-mapping:manage permission to sync
            or map entries.
          </p>
        ) : null}
      </CardBody>
    </Card>
    </section>
  );
}
