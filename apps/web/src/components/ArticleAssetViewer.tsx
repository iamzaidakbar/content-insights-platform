import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Shrink,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import type { Article, ArticleAsset, ArticleAssetKind } from '@content-insights/shared';

import { getApiErrorMessage } from '../lib/api-client';
import { downloadArticle, fetchArticlePreviewUrl } from '../lib/articles-api';
import { formatBytes } from '../lib/format';

// Only pdf/image assets get a native inline preview here. A `full_text` asset is just the
// original uploaded file (docx/txt/csv/xlsx/md/html per article.routes.ts's
// fileTypeBucket -> assetKind mapping) with nothing sensibly renderable as a blob — its
// extracted content already lives in Article.body and is read directly on ArticleDetailPage
// above this component, so a full_text-only article renders no viewer at all (see
// ArticleDetailPage's `hasPreviewableAsset` gate around where this is mounted).
const PREVIEW_PRIORITY: ArticleAssetKind[] = ['pdf', 'image'];

function pickPreviewAsset(assets: ArticleAsset[]): ArticleAsset | undefined {
  for (const kind of PREVIEW_PRIORITY) {
    const match = assets.find((asset) => asset.kind === kind);
    if (match) return match;
  }
  return undefined;
}

const KIND_LABEL: Record<ArticleAssetKind, string> = {
  pdf: 'PDF',
  image: 'Image',
  full_text: 'File',
};

interface ArticleAssetViewerProps {
  article: Article;
  onDownload?: ((asset: ArticleAsset) => void) | undefined;
}

export default function ArticleAssetViewer({ article, onDownload }: ArticleAssetViewerProps) {
  const asset = pickPreviewAsset(article.assets);
  const isImage = asset?.kind === 'image';

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(100);

  const previewQuery = useQuery({
    queryKey: ['article-preview-blob', article.id, asset?.kind],
    queryFn: () => fetchArticlePreviewUrl(article.id, asset?.kind),
    enabled: asset !== undefined,
    staleTime: Infinity,
    gcTime: 0,
  });

  const blobUrl = previewQuery.data;
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // Hooks above must run unconditionally on every render — this early return only happens
  // after all of them have already been declared.
  if (!asset) {
    return null;
  }

  async function handleDownload() {
    // Redundant with the `if (!asset)` guard above (this closure can only ever be invoked
    // after that point in the component's lifetime) — kept so TS narrows `asset` to
    // non-undefined inside this nested function too.
    if (!asset) return;
    if (onDownload) {
      onDownload(asset);
      return;
    }
    const extension = asset.kind === 'pdf' ? '.pdf' : asset.kind === 'image' ? '' : '';
    await downloadArticle(article.id, `${article.title}${extension}`, asset.kind);
  }

  const shell = (
    <div
      className={`flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] ${
        isFullscreen ? 'fixed inset-3 z-50 shadow-2xl' : 'min-h-[420px]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {asset.kind === 'pdf' ? (
            <FileText size={18} className="shrink-0 text-[var(--text-secondary)]" />
          ) : (
            <ImageIcon size={18} className="shrink-0 text-[var(--text-secondary)]" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--text-primary)]">{article.title}</p>
            <p className="truncate text-xs text-[var(--text-muted)]">
              {KIND_LABEL[asset.kind]} attachment
              {typeof asset.fileSizeBytes === 'number' ? ` · ${formatBytes(asset.fileSizeBytes)}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {isImage ? (
            <>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(40, z - 20))}
                className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <ZoomOut size={16} />
              </button>
              <span className="min-w-10 text-center text-xs text-[var(--text-muted)]">{zoom}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(300, z + 20))}
                className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                aria-label="Reset zoom"
                onClick={() => setZoom(100)}
                className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Shrink size={16} />
              </button>
            </>
          ) : null}

          <button
            type="button"
            aria-label="Reload preview"
            onClick={() => void previewQuery.refetch()}
            className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={() => setIsFullscreen((v) => !v)}
            className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            type="button"
            aria-label="Download"
            onClick={() => void handleDownload()}
            className="ml-1 flex items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--accent)]"
          >
            <Download size={14} />
            Download
          </button>
        </div>
      </div>

      <div className={`relative flex-1 overflow-auto ${isFullscreen ? 'min-h-0' : 'max-h-[70vh]'}`}>
        {previewQuery.isLoading ? (
          <div className="flex min-h-[380px] flex-col items-center justify-center gap-2 text-[var(--text-secondary)]">
            <Loader2 size={22} className="animate-spin text-[var(--accent)]" />
            <span className="text-sm">Loading preview…</span>
          </div>
        ) : previewQuery.isError ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-[var(--red)]">
              {getApiErrorMessage(previewQuery.error, 'Unable to load this file.')}
            </p>
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--on-accent)]"
            >
              Download instead
            </button>
          </div>
        ) : asset.kind === 'pdf' && blobUrl ? (
          <iframe
            src={`${blobUrl}#view=FitH`}
            title={`Preview of ${article.title}`}
            className="h-full min-h-[560px] w-full border-0 bg-white"
          />
        ) : isImage && blobUrl ? (
          <div className="flex min-h-[380px] items-center justify-center overflow-auto bg-[var(--bg-primary)] p-6">
            <img
              src={blobUrl}
              alt={article.title}
              style={{ width: `${zoom}%`, maxWidth: 'none' }}
              className="rounded-[var(--radius-input)] shadow-lg transition-[width] duration-150"
            />
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {isFullscreen ? <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setIsFullscreen(false)} aria-hidden /> : null}
      {shell}
    </>
  );
}
