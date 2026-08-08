import type { DocumentStatus } from '@content-insights/shared';

const STATUS_STYLES: Record<DocumentStatus, string> = {
  pending: 'border border-slate-700 bg-slate-800 text-slate-300',
  processing: 'animate-pulse border border-blue-800 bg-blue-950 text-blue-300',
  chunked: 'animate-pulse border border-indigo-800 bg-indigo-950 text-indigo-300',
  indexed: 'border border-emerald-800 bg-emerald-950 text-emerald-300',
  failed: 'border border-red-800 bg-red-950 text-red-300',
};
const STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  chunked: 'Chunked',
  indexed: 'Indexed',
  failed: 'Failed',
};

export default function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
