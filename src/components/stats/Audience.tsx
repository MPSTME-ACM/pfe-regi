'use client';

import { Bar } from 'react-chartjs-2';
import { Card, ChartBox, EmptyState } from './chrome';
import { SERIES, hue, horizontalBarOptions, nf } from './theme';
import type { StatsResponse } from './types';

/**
 * Who is in the room: department mix, and where they study.
 */

export function Departments({ stats }: { stats: StatsResponse }) {
  // Non-zero only, descending. Thirteen departments are configured and four are
  // in use; rendering nine empty rows would bury the four that matter.
  const rows = Object.entries(stats.departments)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <Card title="Department" note="Confirmed registrations" className="lg:col-span-2">
      {rows.length === 0 ? (
        <EmptyState message="No confirmed registrations yet." />
      ) : (
        <ChartBox height={rows.length > 6 ? 'h-[340px]' : 'h-[240px]'}>
          <Bar
            data={{
              labels: rows.map(([name]) => name),
              datasets: [
                {
                  label: 'Registrations',
                  data: rows.map(([, n]) => n),
                  backgroundColor: rows.map((_, i) => hue(i, rows.length)),
                  hoverBackgroundColor: rows.map((_, i) => hue(i, rows.length)),
                  borderRadius: 5,
                  borderSkipped: false,
                  maxBarThickness: 26,
                },
              ],
            }}
            options={horizontalBarOptions}
          />
        </ChartBox>
      )}
    </Card>
  );
}

/**
 * NMIMS versus everyone else.
 *
 * Deliberately not a doughnut. Every registration so far is NMIMS, and a
 * single slice at 100% is just a filled circle — a labelled split bar still
 * reads correctly when one side is zero.
 */
export function Colleges({ stats }: { stats: StatsResponse }) {
  const known = Object.entries(stats.colleges).sort((a, b) => b[1] - a[1]);
  const total = known.reduce((sum, [, n]) => sum + n, 0) + stats.fromOther;

  const named = Object.entries(stats.otherColleges).sort((a, b) => b[1] - a[1]);
  const namedTotal = named.reduce((sum, [, n]) => sum + n, 0);
  // Registrations made before the college name was collected. Reported rather
  // than dropped, so the named list visibly does not have to add up to the
  // "other" total.
  const unnamed = stats.fromOther - namedTotal;

  return (
    <Card title="College" note="Confirmed registrations">
      {total === 0 ? (
        <EmptyState message="No confirmed registrations yet." />
      ) : (
        <>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
            {known.map(([name, n], i) => (
              <div
                key={name}
                style={{ width: `${(n / total) * 100}%`, backgroundColor: hue(i, known.length + 1) }}
              />
            ))}
            {stats.fromOther > 0 && (
              <div
                style={{ width: `${(stats.fromOther / total) * 100}%`, backgroundColor: SERIES[6] }}
              />
            )}
          </div>

          <dl className="mt-4 space-y-2">
            {known.map(([name, n], i) => (
              <Line key={name} color={hue(i, known.length + 1)} label={name} value={n} />
            ))}
            <Line color={SERIES[6]} label="Other colleges" value={stats.fromOther} />
          </dl>

          {named.length > 0 && (
            <div className="mt-4 border-t border-hairline pt-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Which ones
              </h3>
              <ul className="mt-2 space-y-1">
                {named.map(([name, n]) => (
                  <li key={name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words text-gray-300">{name}</span>
                    <span className="shrink-0 tabular-nums text-white">{nf.format(n)}</span>
                  </li>
                ))}
                {unnamed > 0 && (
                  <li className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-gray-500">Not recorded</span>
                    <span className="shrink-0 tabular-nums text-gray-500">{nf.format(unnamed)}</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {named.length === 0 && stats.fromOther > 0 && (
            <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-gray-400">
              These registered before the college name was collected, so there is nothing
              to break down yet.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Line({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span aria-hidden className="size-2.5 shrink-0 self-center rounded-full" style={{ backgroundColor: color }} />
      <dt className="min-w-0 flex-1 break-words text-sm text-gray-300">{label}</dt>
      <dd className="shrink-0 text-sm font-semibold tabular-nums text-white">{nf.format(value)}</dd>
    </div>
  );
}
