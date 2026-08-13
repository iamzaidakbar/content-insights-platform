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
import { downloadArticle, fetchArticlePreviewBlob } from '../lib/articles-api';
import { formatBytes } from '../lib/format';
import { cn } from '../lib/cn';

const TEXT_PREVIEW_EXTS = new Set(['.txt', '.md', '.csv', '.html', '.htm']);

function assetExtension(asset: ArticleAsset): string {
  const slash = Math.max(asset.url.lastIndexOf('/'), asset.url.lastIndexOf('\\'));
  const name = slash >= 0 ? asset.url.slice(slash + 1) : asset.url;
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function isBrowserPreviewable(asset: ArticleAsset): boolean {
  if (asset.kind === 'pdf' || asset.kind === 'image') return true;
  return asset.kind === 'full_text' && TEXT_PREVIEW_EXTS.has(assetExtension(asset));
}

export function pickPreviewAsset(assets: ArticleAsset[]): ArticleAsset | undefined {
  const priority: ArticleAssetKind[] = ['pdf', 'image', 'full_text'];
  for (const kind of priority) {
    const match = assets.find((asset) => asset.kind === kind && isBrowserPreviewable(asset));
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
  /** Fill a parent overlay instead of the inline detail-page card. */
  fill?: boolean | undefined;
}

export default function ArticleAssetViewer({ article, onDownload, fill = false }: ArticleAssetViewerProps) {
  const asset = pickPreviewAsset(article.assets);
  const isImage = asset?.kind === 'image';
  const ext = asset ? assetExtension(asset) : '';
  const isText = asset?.kind === 'full_text';
  const isHtml = isText && (ext === '.html' || ext === '.htm');

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(100);

  const previewQuery = useQuery({
    queryKey: ['article-preview-blob', article.id, asset?.kind],
    queryFn: async () => {
      if (!asset) throw new Error('No previewable asset.');
      const blob = await fetchArticlePreviewBlob(article.id, asset.kind);
      const blobUrl = URL.createObjectURL(blob);
      const text = asset.kind === 'full_text' ? await blob.text() : undefined;
      return { blobUrl, text };
    },
    enabled: asset !== undefined,
    staleTime: Infinity,
    gcTime: 0,
  });

  const blobUrl = previewQuery.data?.blobUrl;
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

  if (!asset) {
    return null;
  }

  async function handleDownload() {
    if (!asset) return;
    if (onDownload) {
      onDownload(asset);
      return;
    }
    const extension = assetExtension(asset) || (asset.kind === 'pdf' ? '.pdf' : '');
    await downloadArticle(article.id, `${article.title}${extension}`, asset.kind);
  }

  const overlay = isFullscreen || fill;

  const shell = (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-card',
        isFullscreen ? 'fixed inset-3 z-50 shadow-2xl' : fill ? 'h-full min-h-0' : 'min-h-[420px]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {asset.kind === 'image' ? (
            <ImageIcon size={18} className="shrink-0 text-muted-foreground" />
          ) : (
            <FileText size={18} className="shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{article.title}</p>
            <p className="truncate text-xs text-muted-foreground">
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
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
              >
                <ZoomOut size={16} />
              </button>
              <span className="min-w-10 text-center text-xs text-muted-foreground">{zoom}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(300, z + 20))}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                aria-label="Reset zoom"
                onClick={() => setZoom(100)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
              >
                <Shrink size={16} />
              </button>
            </>
          ) : null}

          <button
            type="button"
            aria-label="Reload preview"
            onClick={() => void previewQuery.refetch()}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
          >
            <RefreshCw size={16} />
          </button>
          {fill ? null : (
            <button
              type="button"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={() => setIsFullscreen((v) => !v)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          <button
            type="button"
            aria-label="Download"
            onClick={() => void handleDownload()}
            className="ml-1 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:border-primary"
          >
            <Download size={14} />
            Download
          </button>
        </div>
      </div>

      <div className={cn('relative flex-1 overflow-auto', overlay ? 'min-h-0' : 'max-h-[70vh]')}>
        {previewQuery.isLoading ? (
          <div className="flex min-h-[380px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 size={22} className="animate-spin text-primary" />
            <span className="text-sm">Loading preview…</span>
          </div>
        ) : previewQuery.isError ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-destructive">
              {getApiErrorMessage(previewQuery.error, 'Unable to load this file.')}
            </p>
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
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
          <div className="flex min-h-[380px] items-center justify-center overflow-auto bg-background p-6">
            <img
              src={blobUrl}
              alt={article.title}
              style={{ width: `${zoom}%`, maxWidth: 'none' }}
              className="rounded-md shadow-lg transition-[width] duration-150"
            />
          </div>
        ) : isHtml && previewQuery.data?.text !== undefined ? (
          <iframe
            sandbox=""
            srcDoc={previewQuery.data.text}
            title={`Preview of ${article.title}`}
            className="h-full min-h-[560px] w-full border-0 bg-white"
          />
        ) : isText && previewQuery.data?.text !== undefined ? (
          <pre className="min-h-[380px] whitespace-pre-wrap break-words p-4 text-sm leading-relaxed text-foreground">
            {previewQuery.data.text}
          </pre>
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
