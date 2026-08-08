import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mammoth from 'mammoth';
// Legacy Node-compatible build. We only ever call getTextContent() (no
// rendering), so this never needs the optional `canvas` peer dependency —
// that's specifically what let us avoid pdf-parse@2.x's native binaries.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { DocumentFileType } from '@content-insights/shared';

import { readFile } from './storage.js';

// pdfjs-dist ships its standard font metrics/CMaps as static assets inside
// the package; pointing it at them avoids "Ensure that the
// standardFontDataUrl API parameter is provided" warnings on PDFs that
// reference standard (non-embedded) fonts.
const pdfjsPackageDir = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const standardFontDataUrl = `${path.join(pdfjsPackageDir, 'standard_fonts')}${path.sep}`;
const cMapUrl = `${path.join(pdfjsPackageDir, 'cmaps')}${path.sep}`;

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
  return pageTexts.join('\n');
}

export async function extractText(fileKey: string, fileType: DocumentFileType): Promise<string> {
  const buffer = await readFile(fileKey);
  switch (fileType) {
    case 'pdf':
      return extractPdfText(buffer);
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case 'txt':
      return buffer.toString('utf-8');
    default: {
      const exhaustiveCheck: never = fileType;
      throw new Error(`Unsupported file type: ${String(exhaustiveCheck)}`);
    }
  }
}
