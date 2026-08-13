'use client';

import { Doughnut, Line } from 'react-chartjs-2';
import { Card, ChartBox, EmptyState } from './chrome';
import { AWAITING, CONFIRMED, FAILED, doughnutOptions, hue, lineOptions, shortDay } from './theme';
import type { StatsResponse } from './types';

/**
 * Registrations per day.
 *
 * Three series, not two. Failures used to be drawn on the "Pending" line, which
 * made a day of abandoned checkouts look like a day of people still deciding.
 * Failed is muted red and sits underneath — present when you look for it,
 * never competing with the line that matters.
 */
export function DailyTrend({ stats }: { stats: StatsResponse }) {
  const days = Object.keys(stats.daily);
  const quiet = days.every((d) => {
    const v = stats.daily[d];
    return v.success === 0 && v.pending === 0 && v.failure === 0;
  });

  return (
    <Card title="Daily registrations" note="Last 10 days" className="lg:col-span-2">
      {quiet ? (
        <EmptyState message="No registrations in the last 10 days." />
      ) : (
        <ChartBox height="h-[280px] sm:h-[300px]">
          <Line
            data={{
              labels: days.map(shortDay),
              datasets: [
                {
                  label: 'Confirmed',
                  data: days.map((d) => stats.daily[d].success),
                  borderColor: CONFIRMED,
                  backgroundColor: 'rgba(233,123,252,0.14)',
                  pointBackgroundColor: CONFIRMED,
                  fill: true,
                },
                {
                  label: 'Awaiting',
                  data: days.map((d) => stats.daily[d].pending),
                  borderColor: AWAITING,
                  backgroundColor: 'rgba(251,191,36,0.12)',
                  pointBackgroundColor: AWAITING,
                  fill: true,
                },
                {
                  label: 'Failed',
                  data: days.map((d) => stats.daily[d].failure),
                  borderColor: FAILED,
                  backgroundColor: 'rgba(248,113,113,0.08)',
                  pointBackgroundColor: FAILED,
                  fill: true,
                },
              ],
            }}
            options={lineOptions(days)}
          />
        </ChartBox>
      )}
    </Card>
  );
}

export function YearMix({ stats }: { stats: StatsResponse }) {
  const labels = Object.keys(stats.years);
  const values = Object.values(stats.years);

  return (
    <Card title="Year-wise registrations" note="Confirmed registrations">
      {labels.length === 0 ? (
        <EmptyState message="No data available." />
      ) : (
        <ChartBox height="h-[280px] sm:h-[300px]">
          <Doughnut
            data={{
              labels,
              datasets: [
                {
                  data: values,
                  backgroundColor: labels.map((_, i) => hue(i, labels.length)),
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
