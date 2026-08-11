import type { ChartSeriesMeta, ChartValueMatrix } from './chart-types';
import { valueAt } from './chart-types';

interface ChartDataTableProps {
  categoryHeader: string; // e.g. "Category", "Axis" — names the row dimension
  categories: string[];
  series: ChartSeriesMeta[];
  values: ChartValueMatrix;
  formatValue?: ((value: number) => string) | undefined;
}

// The WCAG-clean twin every chart in this file ships alongside its visual render — the
// dataviz skill lists "no table view / color-only encoding on a continuous scale" as an
// anti-pattern. Every value here is read from the exact same (categories, series, values)
// the SVG renders, never a parallel computation, so the two can't drift apart.
export default function ChartDataTable({ categoryHeader, categories, series, values, formatValue }: ChartDataTableProps) {
  const format = formatValue ?? ((value: number) => value.toLocaleString());
  return (
    <div className="max-h-64 overflow-auto rounded-[var(--radius-input)] border border-[var(--chart-gridline)]">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="sticky top-0" style={{ backgroundColor: 'var(--chart-surface)' }}>
            <th
              scope="col"
              className="border-b border-[var(--chart-gridline)] px-2 py-1.5 font-medium"
              style={{ color: 'var(--chart-ink-secondary)' }}
            >
              {categoryHeader}
            </th>
            {series.map((seriesMeta) => (
              <th
                key={seriesMeta.key}
                scope="col"
                className="border-b border-[var(--chart-gridline)] px-2 py-1.5 text-right font-medium"
                style={{ color: 'var(--chart-ink-secondary)' }}
              >
                {seriesMeta.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, categoryIndex) => (
            <tr key={category} className="border-b border-[var(--chart-gridline)] last:border-b-0">
              <th scope="row" className="px-2 py-1.5 font-normal" style={{ color: 'var(--chart-ink-primary)' }}>
                {category}
              </th>
              {series.map((seriesMeta, seriesIndex) => (
                <td
                  key={seriesMeta.key}
                  className="px-2 py-1.5 text-right tabular-nums"
                  style={{ color: 'var(--chart-ink-primary)' }}
                >
                  {format(valueAt(values, seriesIndex, categoryIndex))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
