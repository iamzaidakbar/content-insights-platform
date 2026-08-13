import { formatCompactNumber } from '../../lib/format';

interface StatTileProps {
  label: string;
  value: number;
}

// The bare hero-figure case — per the dataviz skill, the one form that skips the hover
// layer entirely (there's no plot to hover). Proportional figures, never tabular-nums, at
// this display size.
export default function StatTile({ label, value }: StatTileProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 py-6 text-center">
      <span className="text-3xl font-semibold text-foreground">{formatCompactNumber(value)}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
