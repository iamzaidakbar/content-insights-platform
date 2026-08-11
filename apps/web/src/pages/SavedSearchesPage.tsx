import { useNavigate } from 'react-router-dom';
import { SavedQueriesPanel } from '../components/SavedQueriesModal';
import { PageBody, PageHeader } from '../components/ui';
import {
  ARTICLES_LOAD_SAVED_SEARCH_PARAM,
  type LoadSavedSearchResult,
} from '../lib/saved-searches-api';

// The standalone /saved-searches route — now just the shared SavedQueriesPanel embedded
// full-page (no `currentFilters`, so its "Save current search" tab stays hidden here; that
// only makes sense from Articles, which has an active search in hand). All list/rename/
// share/expose/export/delete logic lives once in SavedQueriesModal.tsx, not duplicated here.
export default function SavedSearchesPage() {
  const navigate = useNavigate();

  function handleLoad(loaded: LoadSavedSearchResult) {
    navigate(
      `/articles?${ARTICLES_LOAD_SAVED_SEARCH_PARAM}=${encodeURIComponent(loaded.savedSearch.id)}`,
    );
  }

  return (
    <PageBody width="lg">
      <PageHeader
        title="Saved Searches"
        description="Queries saved from Articles — your own, your groups' defaults, and anything shared with you."
      />
      <SavedQueriesPanel onLoad={handleLoad} />
    </PageBody>
  );
}
