export interface TextChunk {
  index: number;
  text: string;
  wordStart: number;
  wordEnd: number;
}

const CHUNK_SIZE_WORDS = 500;
const CHUNK_OVERLAP_WORDS = 50;
const CHUNK_STRIDE_WORDS = CHUNK_SIZE_WORDS - CHUNK_OVERLAP_WORDS; // 450

export function chunkText(text: string): TextChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const chunks: TextChunk[] = [];
  let index = 0;
  for (let start = 0; start < words.length; start += CHUNK_STRIDE_WORDS) {
    const end = Math.min(start + CHUNK_SIZE_WORDS, words.length);
    chunks.push({ index, text: words.slice(start, end).join(' '), wordStart: start, wordEnd: end });
    index += 1;
    if (end === words.length) break;
  }
  return chunks;
}
