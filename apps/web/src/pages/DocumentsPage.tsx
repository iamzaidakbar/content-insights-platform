import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { getApiErrorMessage } from '../lib/api-client';
import { fetchDocuments } from '../lib/documents-api';
import { formatBytes, formatDate } from '../lib/format';
import StatusBadge from '../components/StatusBadge';

const SKELETON_ROW_COUNT = 6;

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-900">
      <td className="py-3 pr-4">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-800" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-slate-800" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-5 w-20 animate-pulse rounded-full bg-slate-800" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-slate-800" />
      </td>
      <td className="py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-slate-800" />
      </td>
    </tr>
  );
}

export default function DocumentsPage() {
  const [page, setPage] = useState(1);

  const documentsQuery = useQuery({
    queryKey: ['documents', page],
    queryFn: () => fetchDocuments(page),
    placeholderData: keepPreviousData,
  });

  const result = documentsQuery.data;
  const documents = result?.items ?? [];
  const totalPages = result?.totalPages ?? 1;
  const showEmptyState =
    !documentsQuery.isLoading && !documentsQuery.isError && documents.length === 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="mt-1 text-sm text-slate-400">Documents uploaded to your organization.</p>
        </div>
        <Link
          to="/documents/upload"
          className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
        >
          Upload document
        </Link>
      </div>

      {documentsQuery.isError ? (
        <p className="mt-6 text-sm text-red-400">
          {getApiErrorMessage(documentsQuery.error, 'Unable to load documents.')}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="pb-2 pr-4 font-medium">Title</th>
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 font-medium">Size</th>
              <th className="pb-2 font-medium">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {documentsQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                  <SkeletonRow key={index} />
                ))
              : documents.map((document) => (
                  <tr key={document.id} className="border-b border-slate-900">
                    <td className="py-3 pr-4 text-slate-100">{document.title}</td>
                    <td className="py-3 pr-4 text-slate-400">{document.fileType}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={document.status} />
                    </td>
                    <td className="py-3 pr-4 text-slate-400">
                      {formatBytes(document.fileSizeBytes)}
                    </td>
                    <td className="py-3 text-slate-400">{formatDate(document.createdAt)}</td>
                  </tr>
                ))}
          </tbody>
        </table>

        {showEmptyState ? (
          <div className="py-12 text-center">
            <p className="text-slate-400">No documents yet.</p>
            <Link to="/documents/upload" className="mt-2 inline-block text-slate-100 underline">
              Upload your first document
            </Link>
          </div>
        ) : null}
      </div>

      {!documentsQuery.isLoading && documents.length > 0 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {result?.page ?? page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
