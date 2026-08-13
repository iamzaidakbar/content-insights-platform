import { type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Download, ExternalLink, FileText, Globe, Loader2, Users } from 'lucide-react';

import type { Article, ArticleAsset } from '@content-insights/shared';

import { getApiErrorMessage } from '../lib/api-client';
import { downloadArticle, fetchArticle } from '../lib/articles-api';
import { formatDate } from '../lib/format';
import ArticleAssetViewer, { pickPreviewAsset } from './ArticleAssetViewer';
import EmptyState from './EmptyState';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Modal from './ui/Modal';

const SOURCE_TYPE_LABEL: Record<Article['sourceType'], string> = {
  news: 'News',
  file_system: 'File System',
};

interface ArticlePreviewModalProps {
  articleId: string;
  onClose: () => void;
}

function filenameForAsset(article: Article, asset: ArticleAsset): string {
  const baseName = article.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'article';
  const dotIndex = asset.url.lastIndexOf('.');
  const extFromUrl = dotIndex >= 0 ? asset.url.slice(dotIndex) : '';
  const fallbackExt = asset.kind === 'pdf' ? '.pdf' : asset.kind === 'image' ? '.jpg' : '.txt';
  return `${baseName}${extFromUrl || fallbackExt}`;
}

async function handleDownload(article: Article, asset: ArticleAsset): Promise<void> {
  await downloadArticle(article.id, filenameForAsset(article, asset), asset.kind);
}

function renderBodyParagraphs(text: string): ReactNode[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.split(/\n{2,}/).map((paragraph, index) => (
    <p key={index} className="mt-2.5 whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)] first:mt-0">
      {paragraph.trim()}
    </p>
  ));
}

function ArticleReadingView({ article, extractedFile }: { article: Article; extractedFile: boolean }) {
  const body = renderBodyParagraphs(article.body);

  return (
    <div>
      {extractedFile ? (
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          This file type cannot be previewed in the browser. Extracted text is shown below.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
        <span className="flex items-center gap-1">
          <Globe size={12} className="shrink-0" />
          {article.domain}
        </span>
        <span className="flex items-center gap-1">
          <Calendar size={12} className="shrink-0" />
          {formatDate(article.publishedAt)}
        </span>
        {article.authors.length > 0 ? (
          <span className="flex items-center gap-1">
            <Users size={12} className="shrink-0" />
            {article.authors.join(', ')}
          </span>
        ) : null}
        <Badge variant="default">{SOURCE_TYPE_LABEL[article.sourceType]}</Badge>
      </div>
      {article.summary.trim() ? (
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{article.summary.trim()}</p>
      ) : null}
      <div className="mt-4">
        {body ?? (
          <p className="text-sm text-[var(--text-muted)]">
            No article text is available yet.
            {article.url ? ' Use “Open original” to read it at the source.' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ArticlePreviewModal({ articleId, onClose }: ArticlePreviewModalProps) {
  const articleQuery = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => fetchArticle(articleId),
  });
  const article = articleQuery.data;
  const previewAsset = article ? pickPreviewAsset(article.assets) : undefined;
  const downloadAsset = article?.assets[0];

  const footer =
    article && (article.url || downloadAsset) ? (
      <>
        {article.url ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={<ExternalLink size={14} />}
            onClick={() => window.open(article.url!, '_blank', 'noopener,noreferrer')}
          >
            Open original
          </Button>
        ) : null}
        {downloadAsset ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Download size={14} />}
            onClick={() => void handleDownload(article, downloadAsset)}
          >
            Download
          </Button>
        ) : null}
      </>
    ) : undefined;

  return (
    <Modal open onClose={onClose} title={article?.title ?? 'Preview'} size="lg" footer={footer}>
      <div className="max-h-[min(60vh,420px)] overflow-y-auto cip-scroll">
        {articleQuery.isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--text-secondary)]">
            <Loader2 size={22} className="animate-spin text-[var(--accent)]" />
            <span className="text-sm">Loading preview…</span>
          </div>
        ) : articleQuery.isError || !article ? (
          <EmptyState
            icon={FileText}
            title="Unable to open this preview"
            description={getApiErrorMessage(articleQuery.error, 'The article could not be loaded.')}
          />
        ) : previewAsset ? (
          <div className="h-[min(50vh,320px)]">
            <ArticleAssetViewer
              article={article}
              fill
              onDownload={(asset) => void handleDownload(article, asset)}
            />
          </div>
        ) : (
          <ArticleReadingView article={article} extractedFile={article.assets.length > 0} />
        )}
      </div>
    </Modal>
  );
}
