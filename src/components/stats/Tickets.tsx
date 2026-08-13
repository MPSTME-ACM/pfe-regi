'use client';

import { Bar, Doughnut } from 'react-chartjs-2';
import { Card, ChartBox, EmptyState } from './chrome';
import { SERIES, hue, doughnutOptions, horizontalBarOptions, nf } from './theme';
import type { StatsResponse } from './types';

const SKU_LABELS: Record<keyof StatsResponse['skus'], string> = {
  capstone: 'Capstone Day only',
  single: 'Single track',
  bundle: 'Bundle',
};

/** Three products, three fixed colours, so the mix reads the same every visit. */
const SKU_COLOURS: Record<keyof StatsResponse['skus'], string> = {
  capstone: SERIES[6],
  single: SERIES[3],
  bundle: SERIES[0],
};

export function TicketMix({ stats }: { stats: StatsResponse }) {
  const entries = (Object.keys(SKU_LABELS) as (keyof StatsResponse['skus'])[])
    .map((key) => ({ key, label: SKU_LABELS[key], value: stats.skus[key] }))
    .filter((e) => e.value > 0);

  return (
    <Card title="What people bought" note="Confirmed registrations">
      {entries.length === 0 ? (
        <EmptyState message="No confirmed registrations yet." />
      ) : (
        <ChartBox height="h-[280px] sm:h-[300px]">
          <Doughnut
            data={{
              labels: entries.map((e) => e.label),
              datasets: [
                {
                  data: entries.map((e) => e.value),
                  backgroundColor: entries.map((e) => SKU_COLOURS[e.key]),
                  borderColor: 'transparent',
                  borderWidth: 0,
                  hoverOffset: 6,
                },
              ],
            }}
            options={doughnutOptions}
          />
        </ChartBox>
      )}
    </Card>
  );
}

/**
 * Which track combinations people actually pick.
 *
 * One row per distinct purchase shape, so a bundle's *pairing* is visible. That
 * is the one thing the per-track seat counts cannot answer: they show Python and
 * AI are both popular, never that they are popular *together*.
 */
export function Combinations({ stats }: { stats: StatsResponse }) {
  const rows = stats.combos.filter((c) => c.count > 0);

  return (
    <Card
      title="Popular combinations"
      note="Confirmed registrations, most common first"
      className="lg:col-span-2"
    >
      {rows.length === 0 ? (
        <EmptyState message="No confirmed registrations yet." />
      ) : (
        <ChartBox height={rows.length > 6 ? 'h-[340px]' : 'h-[260px]'}>
          <Bar
            data={{
              labels: rows.map(comboLabel),
              datasets: [
                {
                  label: 'Registrations',
                  data: rows.map((c) => c.count),
                  backgroundColor: rows.map(comboColour),
                  hoverBackgroundColor: rows.map(comboColour),
                  borderRadius: 5,
                  borderSkipped: false,
                  maxBarThickness: 24,
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
 * `Python → AI + Capstone`, `C Programming`, `Capstone Day only`.
 *
 * The arrow is reserved for a real beginner→advanced progression, which is what
 * a bundle is. Using it for a single track would imply a pairing nobody bought.
 */
function comboLabel(c: StatsResponse['combos'][number]): string {
  const track =
    c.beginner && c.advanced ? `${c.beginner} → ${c.advanced}` : (c.beginner ?? c.advanced);

  if (!track) return 'Capstone Day only';
  return c.capstone ? `${track} + Capstone` : track;
}

/** Bundles in the accent, singles in blue, capstone-only in teal. */
function comboColour(c: StatsResponse['combos'][number]): string {
  if (c.beginner && c.advanced) return SERIES[0];
  if (!c.beginner && !c.advanced) return SERIES[6];
  return SERIES[3];
}

/** Seats are a different unit from registrations, hence the note spelling it out. */
export function TrackSeats({ stats }: { stats: StatsResponse }) {
  const labels = Object.keys(stats.domains);
  const values = Object.values(stats.domains);
  const seats = values.reduce((a, b) => a + b, 0);

  return (
    <Card
      title="Seats sold by track"
      note={`A bundle occupies three seats — ${nf.format(seats)} seats across ${nf.format(stats.total)} people.`}
      className="lg:col-span-2"
    >
      {values.every((v) => v === 0) ? (
        <EmptyState message="No seats sold yet." />
      ) : (
        <ChartBox height="h-[320px] sm:h-[340px]">
          <Bar
            data={{
              labels,
              datasets: [
                {
                  label: 'Seats sold',
                  data: values,
                  backgroundColor: labels.map((_, i) => hue(i, labels.length)),
                  hoverBackgroundColor: labels.map((_, i) => hue(i, labels.length)),
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
