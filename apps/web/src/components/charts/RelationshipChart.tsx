import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { Network } from 'lucide-react';

import type { AggregationResult } from '@content-insights/shared';

import { formatCompactNumber } from '../../lib/format';
import EmptyState from '../EmptyState';
import ChartViewToggle from './ChartViewToggle';
import { categoricalColor } from './chart-types';

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 320;
const PADDING_Y = 24;
const LEFT_X = 110;
const RIGHT_X = VIEW_WIDTH - 110;
const MIN_RADIUS = 6;
const MAX_RADIUS = 16;
const MIN_STROKE = 1;
const MAX_STROKE = 8;
// Beyond this many distinct values per side the bipartite layout gets too dense to read
// or hover reliably — the diagram shows the strongest N by total co-occurrence; the table
// view (below) always lists every edge it was given, capped or not.
const MAX_NODES_PER_SIDE = 10;
const LABEL_MAX_CHARS = 18;

export interface RelationshipEdge {
  source: string;
  target: string;
  // Co-occurrence strength between `source` and `target` (e.g. "how many articles have
  // both this Category value and this Location value"). GET /api/insights/:id/data does
  // not compute this today — every field mapping comes back as its own independent terms
  // aggregation (see insight.routes.ts), so a joint pair count needs either a future
  // dedicated backend aggregation or client-side pairing before it reaches this component.
  // This component only renders whatever edges it's given; it never fabricates a weight
  // from two independent distributions.
  weight: number;
}

interface RelationshipChartProps {
  // The real, honest input: precomputed co-occurrence pairs. Optional/defaulted to `[]`
  // because InsightTile.tsx's generic chart-loader contract (dashboards/chart-loader.ts's
  // InsightChartProps) doesn't have a field like this — it only passes `buckets` and
  // `aggregations` — so this is what a caller with genuine joint data supplies (e.g. a
  // future dedicated backend aggregation, or client-side pairing), never fabricated here.
  edges?: RelationshipEdge[] | undefined;
  // What GET /api/insights/:id/data actually returns for this chart type today: one
  // independent terms aggregation per field-mapping role (e.g. 'sourceNode'/'targetNode' —
  // see ChartFieldMapping's own doc comment), NOT a joint pair count. Accepted so this
  // component matches the real prop shape InsightTile.tsx passes, and used ONLY to render a
  // specific, honest "pairing not available" message (naming the two concepts and how many
  // values each has) — never to fabricate a co-occurrence weight from two independent
  // distributions, which would misrepresent the data.
  aggregations?: AggregationResult[] | undefined;
  sourceLabel?: string | undefined; // e.g. the source concept's display name, for the legend
  targetLabel?: string | undefined;
}

interface RelNode {
  key: string;
  total: number;
  degree: number;
  y: number;
  r: number;
}

interface HoverState {
  side: 'source' | 'target';
  key: string;
  x: number;
  y: number;
}

function truncateLabel(label: string, max = LABEL_MAX_CHARS): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function buildNodes(edges: RelationshipEdge[], side: 'source' | 'target'): { key: string; total: number; degree: number }[] {
  const totals = new Map<string, number>();
  const degree = new Map<string, number>();
  for (const edge of edges) {
    const key = side === 'source' ? edge.source : edge.target;
    totals.set(key, (totals.get(key) ?? 0) + edge.weight);
    degree.set(key, (degree.get(key) ?? 0) + 1);
  }
  return Array.from(totals.entries())
    .map(([key, total]) => ({ key, total, degree: degree.get(key) ?? 0 }))
    .sort((a, b) => b.total - a.total);
}

function positionNodes(nodes: { key: string; total: number; degree: number }[], maxTotal: number): RelNode[] {
  const plotHeight = VIEW_HEIGHT - PADDING_Y * 2;
  return nodes.map((node, index) => ({
    ...node,
    y: nodes.length > 1 ? PADDING_Y + (plotHeight * index) / (nodes.length - 1) : VIEW_HEIGHT / 2,
    r: MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(maxTotal > 0 ? node.total / maxTotal : 0),
  }));
}

// Bipartite relationship diagram — source-side values on the left, target-side values on
// the right, connected by co-occurrence edges. A concentric/bipartite layout (per the
// brief) rather than a free-form force simulation: with only two columns of nodes there's
// no crossing-minimization problem a physics sim would meaningfully improve on, and a
// fixed layout is what makes hover-to-highlight predictable. Edge thickness AND opacity
// both encode strength (thickness is the primary channel); nodes are colored by side using
// the same fixed-order categorical ramp as every other chart here.
export default function RelationshipChart({ edges = [], aggregations = [], sourceLabel = 'Source', targetLabel = 'Target' }: RelationshipChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const positiveEdges = useMemo(() => edges.filter((e) => e.weight > 0 && e.source.length > 0 && e.target.length > 0), [edges]);

  const { sourceNodes, targetNodes, visibleEdges, droppedCount } = useMemo(() => {
    const allSourceNodes = buildNodes(positiveEdges, 'source');
    const allTargetNodes = buildNodes(positiveEdges, 'target');
    const sourceKeys = new Set(allSourceNodes.slice(0, MAX_NODES_PER_SIDE).map((n) => n.key));
    const targetKeys = new Set(allTargetNodes.slice(0, MAX_NODES_PER_SIDE).map((n) => n.key));
    const visible = positiveEdges.filter((e) => sourceKeys.has(e.source) && targetKeys.has(e.target));
    return {
      sourceNodes: allSourceNodes.filter((n) => sourceKeys.has(n.key)),
      targetNodes: allTargetNodes.filter((n) => targetKeys.has(n.key)),
      visibleEdges: visible,
      droppedCount: positiveEdges.length - visible.length,
    };
  }, [positiveEdges]);

  // Every hook must run unconditionally (before the empty-data early return below), per
  // the Rules of Hooks — this can't be a separate component-like helper called after that
  // return, so it's inlined here directly.
  const connectedOpposite = useMemo(() => {
    const set = new Set<string>();
    if (!hover) return set;
    for (const edge of visibleEdges) {
      if (hover.side === 'source' && edge.source === hover.key) set.add(edge.target);
      if (hover.side === 'target' && edge.target === hover.key) set.add(edge.source);
    }
    return set;
  }, [hover, visibleEdges]);

  if (positiveEdges.length === 0 || sourceNodes.length === 0 || targetNodes.length === 0) {
    // aggregations (when given, e.g. via InsightTile's generic loader) are two INDEPENDENT
    // marginal distributions, not joint pairs — real enough to name and count here, but
    // never enough to honestly draw an edge between them (that would fabricate a
    // co-occurrence weight nothing measured). Naming what IS available beats a generic
    // "no data" message without pretending to have the pairing.
    const [first, second] = aggregations;
    if (first && second && (first.buckets.length > 0 || second.buckets.length > 0)) {
      return (
        <EmptyState
          icon={Network}
          title="Pairing not available yet"
          description={`Found ${first.buckets.length} ${first.name} value${first.buckets.length === 1 ? '' : 's'} and ${second.buckets.length} ${second.name} value${second.buckets.length === 1 ? '' : 's'}, but this data source doesn't report how often they co-occur yet.`}
        />
      );
    }
    return <EmptyState icon={Network} title="No data" description="No co-occurring pairs matched this widget's query yet." />;
  }

  const maxTotal = Math.max(...sourceNodes.map((n) => n.total), ...targetNodes.map((n) => n.total), 1);
  const maxWeight = Math.max(...visibleEdges.map((e) => e.weight), 1);
  const positionedSource = positionNodes(sourceNodes, maxTotal);
  const positionedTarget = positionNodes(targetNodes, maxTotal);
  const sourceY = new Map(positionedSource.map((n) => [n.key, n.y]));
  const targetY = new Map(positionedTarget.map((n) => [n.key, n.y]));
  const sourceColor = categoricalColor(0);
  const targetColor = categoricalColor(1);

  function isEdgeActive(edge: RelationshipEdge): boolean {
    if (!hover) return true;
    return hover.side === 'source' ? edge.source === hover.key : edge.target === hover.key;
  }
  function isNodeActive(side: 'source' | 'target', key: string): boolean {
    if (!hover) return true;
    if (hover.side === side) return hover.key === key;
    return connectedOpposite.has(key);
  }

  function handleNodeMove(event: MouseEvent<SVGCircleElement>, side: 'source' | 'target', key: string) {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = event.currentTarget.getBoundingClientRect();
    setHover({ side, key, x: nodeRect.left - containerRect.left + nodeRect.width / 2, y: nodeRect.top - containerRect.top });
  }

  const hoveredNode = hover
    ? ((hover.side === 'source' ? positionedSource : positionedTarget).find((n) => n.key === hover.key) ?? null)
    : null;

  const chart = (
    <div ref={containerRef} className="relative">
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="h-auto w-full" role="img" aria-label="Relationship diagram">
        {visibleEdges.map((edge, index) => {
          const sy = sourceY.get(edge.source) ?? VIEW_HEIGHT / 2;
          const ty = targetY.get(edge.target) ?? VIEW_HEIGHT / 2;
          const midX = (LEFT_X + RIGHT_X) / 2;
          const active = isEdgeActive(edge);
          const strokeWidth = MIN_STROKE + (MAX_STROKE - MIN_STROKE) * Math.sqrt(edge.weight / maxWeight);
          return (
            <path
              key={`${edge.source}::${edge.target}::${index}`}
              d={`M${LEFT_X},${sy} C${midX},${sy} ${midX},${ty} ${RIGHT_X},${ty}`}
              fill="none"
              stroke="var(--chart-ink-muted)"
              strokeWidth={strokeWidth}
              opacity={active ? 0.25 + 0.45 * (edge.weight / maxWeight) : 0.05}
              style={{ transition: 'opacity 150ms' }}
            />
          );
        })}

        {positionedSource.map((node) => (
          <g key={`source-${node.key}`}>
            <text x={LEFT_X - 14} y={node.y} textAnchor="end" dominantBaseline="central" fontSize={11} fill="var(--chart-ink-secondary)" opacity={isNodeActive('source', node.key) ? 1 : 0.35}>
              {truncateLabel(node.key)}
            </text>
            <circle
              cx={LEFT_X}
              cy={node.y}
              r={node.r}
              fill={sourceColor}
              stroke="var(--chart-surface)"
              strokeWidth={2}
              opacity={isNodeActive('source', node.key) ? 1 : 0.35}
              style={{ cursor: 'pointer', transition: 'opacity 150ms' }}
              onMouseMove={(event) => handleNodeMove(event, 'source', node.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={(event) => handleNodeMove(event as unknown as MouseEvent<SVGCircleElement>, 'source', node.key)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${node.key}: ${formatCompactNumber(node.total)}`}
            />
          </g>
        ))}

        {positionedTarget.map((node) => (
          <g key={`target-${node.key}`}>
            <circle
              cx={RIGHT_X}
              cy={node.y}
              r={node.r}
              fill={targetColor}
              stroke="var(--chart-surface)"
              strokeWidth={2}
              opacity={isNodeActive('target', node.key) ? 1 : 0.35}
              style={{ cursor: 'pointer', transition: 'opacity 150ms' }}
              onMouseMove={(event) => handleNodeMove(event, 'target', node.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={(event) => handleNodeMove(event as unknown as MouseEvent<SVGCircleElement>, 'target', node.key)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${node.key}: ${formatCompactNumber(node.total)}`}
            />
            <text x={RIGHT_X + 14} y={node.y} textAnchor="start" dominantBaseline="central" fontSize={11} fill="var(--chart-ink-secondary)" opacity={isNodeActive('target', node.key) ? 1 : 0.35}>
              {truncateLabel(node.key)}
            </text>
          </g>
        ))}
      </svg>

      {hover && hoveredNode ? (
        <div
          className="pointer-events-none absolute z-10 flex flex-col gap-0.5 whitespace-nowrap rounded-[var(--radius-button)] border border-[var(--chart-gridline)] px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: hover.x, top: hover.y, transform: 'translate(-50%, calc(-100% - 10px))', backgroundColor: 'var(--chart-surface)' }}
          role="tooltip"
        >
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: hover.side === 'source' ? sourceColor : targetColor }} aria-hidden="true" />
            <span className="font-semibold text-[var(--chart-ink-primary)]">{formatCompactNumber(hoveredNode.total)}</span>
            <span className="text-[var(--chart-ink-secondary)]">{hoveredNode.key}</span>
          </div>
          <span className="text-[10px] text-[var(--chart-ink-muted)]">
            {hoveredNode.degree} connection{hoveredNode.degree === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}

      {droppedCount > 0 ? (
        <p className="mt-2 text-center text-[10px] text-[var(--chart-ink-muted)]">
          Showing the strongest {sourceNodes.length}×{targetNodes.length} values by connection — see the table view for every pair.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-[var(--chart-ink-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: sourceColor }} aria-hidden="true" />
          {sourceLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: targetColor }} aria-hidden="true" />
          {targetLabel}
        </span>
      </div>
    </div>
  );

  const table = <RelationshipTable edges={positiveEdges} sourceLabel={sourceLabel} targetLabel={targetLabel} />;

  return <ChartViewToggle ariaLabel="Relationship diagram" chart={chart} table={table} />;
}

function RelationshipTable({ edges, sourceLabel, targetLabel }: { edges: RelationshipEdge[]; sourceLabel: string; targetLabel: string }) {
  const sorted = useMemo(() => [...edges].sort((a, b) => b.weight - a.weight), [edges]);
  return (
    <div className="max-h-72 overflow-auto rounded-[var(--radius-input)] border border-[var(--chart-gridline)]">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0" style={{ backgroundColor: 'var(--chart-surface)' }}>
          <tr>
            <th scope="col" className="border-b border-[var(--chart-gridline)] px-2 py-1.5 font-medium" style={{ color: 'var(--chart-ink-secondary)' }}>
              {sourceLabel}
            </th>
            <th scope="col" className="border-b border-[var(--chart-gridline)] px-2 py-1.5 font-medium" style={{ color: 'var(--chart-ink-secondary)' }}>
              {targetLabel}
            </th>
            <th scope="col" className="border-b border-[var(--chart-gridline)] px-2 py-1.5 text-right font-medium" style={{ color: 'var(--chart-ink-secondary)' }}>
              Strength
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((edge, index) => (
            <tr key={`${edge.source}::${edge.target}::${index}`} className="border-b border-[var(--chart-gridline)] last:border-b-0">
              <td className="px-2 py-1.5" style={{ color: 'var(--chart-ink-primary)' }}>
                {edge.source}
              </td>
              <td className="px-2 py-1.5" style={{ color: 'var(--chart-ink-primary)' }}>
                {edge.target}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: 'var(--chart-ink-primary)' }}>
                {edge.weight.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
