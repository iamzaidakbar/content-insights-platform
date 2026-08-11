import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mammoth from 'mammoth';
// Legacy Node-compatible build. We only ever call getTextContent() (no
// rendering), so this never needs the optional `canvas` peer dependency —
// that's specifically what let us avoid pdf-parse@2.x's native binaries.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { readFile } from './storage.js';
import { normalizeExtractedText } from './text-normalize.js';

// No canonical "file type" enum exists in @content-insights/shared for Article uploads
// (unlike the pre-Article Document contract this pipeline predates) — the accepted-file-type
// bucket is an upload-endpoint concern local to article.routes.ts's own
// ACCEPTED_MIME_TYPES/UploadFileTypeBucket, not part of the Article entity itself. This is
// the same 8-value union, defined once here since this is the module that actually
// dispatches on it.
export const EXTRACTABLE_FILE_TYPES = ['pdf', 'docx', 'txt', 'csv', 'md', 'html', 'xlsx', 'image'] as const;
export type ExtractableFileType = (typeof EXTRACTABLE_FILE_TYPES)[number];

const EXTENSION_TO_FILE_TYPE: Record<string, ExtractableFileType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'txt',
  '.csv': 'csv',
  '.md': 'md',
  '.html': 'html',
  '.htm': 'html',
  '.xlsx': 'xlsx',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
};

// Article assets don't persist their own upload-time file-type bucket (only the coarser
// `kind`: 'pdf' | 'full_text' | 'image' — see article.model.ts) — this recovers it from the
// stored fileKey's extension for callers (e.g. the ingest worker's re-extraction path) that
// only have the asset, not the original multipart upload, in hand. Returns null for an
// extension this pipeline doesn't know how to extract text from.
export function inferFileTypeFromKey(fileKey: string): ExtractableFileType | null {
  const ext = path.extname(fileKey).toLowerCase();
  return EXTENSION_TO_FILE_TYPE[ext] ?? null;
}

// pdfjs-dist ships its standard font metrics/CMaps as static assets inside
// the package; pointing it at them avoids "Ensure that the
// standardFontDataUrl API parameter is provided" warnings on PDFs that
// reference standard (non-embedded) fonts.
const pdfjsPackageDir = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const standardFontDataUrl = `${path.join(pdfjsPackageDir, 'standard_fonts')}${path.sep}`;
const cMapUrl = `${path.join(pdfjsPackageDir, 'cmaps')}${path.sep}`;

async function extractXlsxText(buffer: Buffer): Promise<string> {
  // exceljs is CJS; default-import + destructure per the same ESM-interop convention
  // as jsonwebtoken (see lib/jwt.ts). Dynamic import keeps the heavy parser out of the
  // module graph until a spreadsheet is actually processed.
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const lines: string[] = [];
  workbook.eachSheet((sheet) => {
    lines.push(sheet.name);
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values : [];
      const cells = values
        .map((v) => {
          if (v == null) return '';
          if (typeof v === 'object') {
            // Rich text / formula / hyperlink cell shapes.
            const obj = v as { text?: unknown; result?: unknown; richText?: Array<{ text: string }> };
            if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join('');
            if (obj.text != null) return String(obj.text);
            if (obj.result != null) return String(obj.result);
            return '';
          }
          return String(v as string | number | boolean);
        })
        .filter((s) => s.length > 0);
      if (cells.length > 0) lines.push(cells.join(' '));
    });
  });
  return lines.join('\n');
}

// Dependency-free HTML → text: good enough for search indexing (not rendering).
function extractHtmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    useWorkerFetch: false,
  }).promise;

  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    pageTexts.push(pageText);
  }
  // normalizeExtractedText is applied by extractText() for every file type.
  return pageTexts.join('\n');
}

export async function extractText(fileKey: string, fileType: ExtractableFileType): Promise<string> {
  const buffer = await readFile(fileKey);
  let text: string;
  switch (fileType) {
    case 'pdf':
      text = await extractPdfText(buffer);
      break;
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      break;
    }
    case 'txt':
    case 'csv':
    case 'md':
      text = buffer.toString('utf-8');
      break;
    case 'html':
      text = extractHtmlText(buffer.toString('utf-8'));
      break;
    case 'xlsx':
      text = await extractXlsxText(buffer);
      break;
    case 'image':
      // No OCR — images are stored/previewed, searchable by title only. The ingest
      // worker indexes a single empty chunk so the title remains queryable.
      return '';
    default: {
      const exhaustiveCheck: never = fileType;
      throw new Error(`Unsupported file type: ${String(exhaustiveCheck)}`);
    }
  }
  // PDF glyph-spacing (and rare DOCX artifacts) leave letter-spaced tokens that
  // break keyword search; normalize every extracted body once here.
  return normalizeExtractedText(text);
}
