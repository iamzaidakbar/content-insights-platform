import { SavedQueriesPanel } from '../components/SavedQueriesModal';
import { PageBody, PageHeader } from '../components/ui';

// The standalone /saved-searches route — now just the shared SavedQueriesPanel embedded
// full-page (no `currentFilters`, so its "Save current search" tab stays hidden here; that
// only makes sense from Articles, which has an active search in hand). All list/rename/
// share/expose/export/delete logic lives once in SavedQueriesModal.tsx, not duplicated here.
export default function SavedSearchesPage() {
  return (
    <PageBody width="lg">
      <PageHeader
        title="Saved Searches"
        description="Queries saved from Articles — your own, your groups' defaults, and anything shared with you."
      />
      <SavedQueriesPanel />
    </PageBody>
  );
}
