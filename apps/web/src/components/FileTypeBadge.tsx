import type { DocumentFileType } from '@content-insights/shared';

const FILE_TYPE_STYLES: Record<DocumentFileType, string> = {
  pdf: 'border border-red-800 bg-red-950 text-red-300',
  docx: 'border border-blue-800 bg-blue-950 text-blue-300',
  txt: 'border border-violet-800 bg-violet-950 text-violet-300',
};
const FILE_TYPE_LABELS: Record<DocumentFileType, string> = { pdf: 'PDF', docx: 'DOCX', txt: 'TXT' };

export default function FileTypeBadge({ fileType }: { fileType: DocumentFileType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${FILE_TYPE_STYLES[fileType]}`}
    >
      {FILE_TYPE_LABELS[fileType]}
    </span>
  );
}
