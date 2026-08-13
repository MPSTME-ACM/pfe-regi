'use client';

import { Card } from './chrome';
import { nf } from './theme';
import type { StatsResponse } from './types';

/**
 * Who is bringing people in.
 *
 * A table, not a chart. These are names read one by one and compared as
 * numbers; encoding them as bar lengths would make the top of the list harder
 * to read, not easier.
 *
 * Two sources, and they are not equivalent:
 *
 *  - **Typed** — whatever the registrant put in the Referral box. Unverified,
 *    self-reported, and today it is all there is: the `referrers` table is
 *    empty, so nothing has ever been attributed the reliable way.
 *  - **Tracked** — resolved through a `/r/<CODE>` link to a real referrer row.
 *    Authoritative, and hidden entirely while empty rather than shown as a
 *    table with a heading and nothing under it.
 */
export default function ReferralLeaderboard({ stats }: { stats: StatsResponse }) {
  const { typed, attributed } = stats.referrers;
  const total = typed.reduce((sum, r) => sum + r.count, 0);

  return (
    <Card
      title="Referral leaderboard"
      note={`Confirmed registrations credited to a name. ${nf.format(total)} of ${nf.format(stats.total)} named someone.`}
    >
      {typed.length === 0 && attributed.length === 0 ? (
        <p className="text-sm leading-relaxed text-gray-400">
          Nobody has been credited yet.
        </p>
      ) : (
        <>
          {attributed.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Tracked links
              </h3>
              <ol className="mt-2">
                {attributed.map((r, i) => (
                  <Row key={r.code} rank={i + 1} label={r.name} count={r.count} hint={`/r/${r.code}`} />
                ))}
              </ol>
            </div>
          )}

          <ol>
            {typed.map((r, i) => (
              <Row
                key={r.label}
                rank={i + 1}
                label={r.label}
                count={r.count}
                // Surfaced rather than silent: the row really is several
                // spellings added together, and someone checking it against the
                // spreadsheet needs to know that before they think it is wrong.
                hint={r.variants > 1 ? `${r.variants} spellings merged` : undefined}
              />
            ))}
          </ol>

          <p className="mt-5 border-t border-hairline pt-4 text-xs leading-relaxed text-gray-400">
            These are typed by registrants, so spelling varies and anyone can write
            anything. Names differing only in case or spacing are counted as one.
            For numbers you can rely on, create a referrer under{' '}
            <span className="text-gray-300">Admin → Coupons → Referrers</span> and share
            their <span className="text-gray-300">/r/CODE</span> link — those get credited
            automatically, whether or not the box is filled in.
          </p>
        </>
      )}
    </Card>
  );
}

function Row({
  rank,
  label,
  count,
  hint,
}: {
  rank: number;
  label: string;
  count: number;
  hint?: string;
}) {
  return (
    <li className="flex items-baseline gap-3 border-b border-white/[0.06] py-2 last:border-0">
      <span className="w-5 shrink-0 text-sm tabular-nums text-gray-500">{rank}</span>
      <span className="min-w-0 flex-1 break-words text-sm text-white">
        {label}
        {hint && <span className="ml-2 text-xs text-gray-500">{hint}</span>}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-accent-soft">
        {nf.format(count)}
      </span>
    </li>
  );
}
