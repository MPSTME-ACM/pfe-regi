'use client';

import { AWAITING, CONFIRMED, FAILED, nf } from './theme';
import type { StatsResponse } from './types';

/**
 * The headline numbers.
 *
 * "Awaiting payment" and "Failed" are separate figures, and that separation is
 * the visible half of a real bug fix. The page used to show one "Pending" count
 * of everything that was not successful, so seven abandoned checkouts sat in the
 * same number as thirteen people who were still mid-payment. Only one of those
 * is worth chasing.
 */
export default function Summary({ stats }: { stats: StatsResponse }) {
  const { statuses, totalAll } = stats;
  const empty = totalAll === 0;

  const pct = (n: number) => (empty ? 0 : (n / totalAll) * 100);
  const rupees = Math.round(stats.revenuePaise / 100);

  return (
    <section className="rounded-2xl border border-hairline bg-panel-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-300">
            Total registered
          </h2>
          <span className="text-3xl font-semibold tabular-nums text-white">
            {nf.format(totalAll)}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-300">
            Collected
          </h2>
          <span className="text-2xl font-semibold tabular-nums text-white">
            ₹{nf.format(rupees)}
          </span>
        </div>
      </div>

      {empty ? (
        <p className="mt-3 text-sm text-gray-400">No registrations yet.</p>
      ) : (
        <>
          {/* Only settled registrations fill the rail. Filling the remainder
              amber meant a day with one pending registration and nothing
              confirmed rendered as a solid amber bar, which reads as an alarm
              rather than "nothing has settled yet". */}
          <div
            className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
            role="img"
            aria-label={`${nf.format(stats.total)} of ${nf.format(totalAll)} registrations confirmed`}
          >
            <div style={{ width: `${pct(stats.total)}%`, backgroundColor: CONFIRMED }} />
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <Figure color={CONFIRMED} label="Confirmed" value={stats.total} percent={pct(stats.total)} />
            <Figure color={AWAITING} label="Awaiting payment" value={statuses.pending} percent={pct(statuses.pending)} />
            <Figure color={FAILED} label="Failed / dropped" value={statuses.failure} percent={pct(statuses.failure)} />
            {statuses.comped > 0 && (
              <Figure color={CONFIRMED} label="of which comped" value={statuses.comped} percent={pct(statuses.comped)} />
            )}
          </dl>
        </>
      )}
    </section>
  );
}

function Figure({
  color,
  label,
  value,
  percent,
}: {
  color: string;
  label: string;
  value: number;
  percent: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <dt className="text-sm text-gray-300">{label}</dt>
      <dd className="text-sm text-white">
        <span className="font-semibold tabular-nums">{nf.format(value)}</span>
        <span className="ml-1.5 text-gray-400 tabular-nums">{percent.toFixed(1)}%</span>
      </dd>
    </div>
  );
}
