const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const unit = BYTE_UNITS[exponent] ?? 'B';
  return `${exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

// Stat-tile/chart value formatting — per the dataviz skill's figures contract
// ("auto-compact: 1,284 / 12.9K / $4.2M"), never tabular-nums at this size.
const compactNumberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(value);
}

const dayLabelFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const monthLabelFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });
const yearLabelFormatter = new Intl.DateTimeFormat('en-US', { year: 'numeric' });

// Formats a dateHistogram bucket's ISO key into an axis-appropriate short label —
// day/week buckets read as "Jan 5", month/quarter as "Jan 26", year as "2026".
export function formatBucketDateLabel(iso: string, interval: 'day' | 'week' | 'month' | 'quarter' | 'year'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (interval === 'year') return yearLabelFormatter.format(date);
  if (interval === 'month' || interval === 'quarter') return monthLabelFormatter.format(date);
  return dayLabelFormatter.format(date);
}
