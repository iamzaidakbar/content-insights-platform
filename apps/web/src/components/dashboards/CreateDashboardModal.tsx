import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { DASHBOARD_MAX_INSIGHTS, type Project } from '@content-insights/shared';

import { getApiErrorMessage } from '../../lib/api-client';
import { createDashboard, updateDashboard } from '../../lib/dashboards-api';
import Button from '../ui/button';
import { Input, Select } from '../ui/input';
import Modal from '../ui/Modal';
import InsightPickerList from './InsightPickerList';

interface CreateDashboardModalProps {
  groupOptions: { id: string; name: string }[];
  projectOptions: Project[];
  onClose: () => void;
}

type Step = 'insights' | 'details';

// A two-step wizard: step 1 picks up to DASHBOARD_MAX_INSIGHTS existing saved Insights to
// import, step 2 collects the dashboard's own name/group/project — "starts by picking
// insights" per the brief, rather than the old model's name-first form. The dashboard itself
// is created empty (createDashboardSchema carries no insightIds) and the picked insights are
// attached in one bulk PUT immediately after, only if any were picked.
export default function CreateDashboardModal({ groupOptions, projectOptions, onClose }: CreateDashboardModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('insights');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(groupOptions[0]?.id ?? '');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);

  function toggleInsight(insightId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(insightId)) {
        next.delete(insightId);
      } else {
        next.add(insightId);
      }
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await createDashboard({
        groupId,
        name: name.trim(),
        ...(projectId ? { projectId } : {}),
      });
      if (selectedIds.size === 0) {
        return created;
      }
      return updateDashboard(created.id, { insightIds: Array.from(selectedIds) });
    },
    onSuccess: (dashboard) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboards-list'] });
      onClose();
      navigate(`/dashboards/${dashboard.id}`);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to create dashboard.')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!groupId) {
      setError('Select a group.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={step === 'insights' ? 'Choose insights' : 'New dashboard'}
      {...(step === 'insights'
        ? {
            description: `Import up to ${DASHBOARD_MAX_INSIGHTS} saved insights, or skip and add them later.`,
          }
        : {})}
      size="md"
      footer={
        step === 'insights' ? (
          <>
            <span className="mr-auto text-xs text-muted-foreground">
              {selectedIds.size}/{DASHBOARD_MAX_INSIGHTS} selected
            </span>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setStep('details')}>Continue</Button>
          </>
        ) : (
          <>
            <Button variant="outline" className="mr-auto" onClick={() => setStep('insights')}>
              Back
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="dashboard-create-form" loading={createMutation.isPending}>
              Create dashboard
            </Button>
          </>
        )
      }
    >
      {step === 'insights' ? (
        <InsightPickerList selectedIds={selectedIds} onToggle={toggleInsight} maxSelectable={DASHBOARD_MAX_INSIGHTS} />
      ) : (
        <form id="dashboard-create-form" className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="dashboard-name" className="block text-sm font-medium text-muted-foreground">
              Name
            </label>
            <Input
              id="dashboard-name"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="dashboard-group" className="block text-sm font-medium text-muted-foreground">
              Group
            </label>
            <Select
              id="dashboard-group"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="mt-1"
            >
              {groupOptions.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </div>
          {projectOptions.length > 0 ? (
            <div>
              <label htmlFor="dashboard-project" className="block text-sm font-medium text-muted-foreground">
                Project <span className="text-muted-foreground">(optional)</span>
              </label>
              <Select
                id="dashboard-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="mt-1"
              >
                <option value="">No project</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
      )}
    </Modal>
  );
}
