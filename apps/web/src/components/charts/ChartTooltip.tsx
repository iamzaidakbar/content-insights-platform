interface ChartTooltipProps {
  x: number;
  y: number;
  label: string;
  value: string;
  swatchColor?: string;
}

// Shared hover-tooltip shell for Bar/Line/Donut — per the dataviz skill: values lead
// (Strong, high-contrast) and the label follows (secondary); the series is keyed with a
// short line stroke, never a filled box, which reads as data-weight ink at this size.
// Positioned via absolute x/y supplied by the caller (relative to a `position: relative`
// chart container), never gating any value that isn't also reachable without hovering.
export default function ChartTooltip({ x, y, label, value, swatchColor }: ChartTooltipProps) {
  return (
    <div
      className="pointer-events-none absolute z-10 flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: x, top: y, transform: 'translate(-50%, calc(-100% - 10px))' }}
      role="tooltip"
    >
      {swatchColor ? (
        <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: swatchColor }} aria-hidden="true" />
      ) : null}
      <span className="font-semibold text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
