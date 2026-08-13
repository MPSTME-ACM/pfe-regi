import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations, tracks, referrers } from '@/lib/db/schema';
import { and, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  CAPSTONE_SLUG,
  OCCUPYING_STATUSES,
  soldCapstone,
  soldPerTrack,
} from '@/lib/registration/capacity';
import { OTHER_COLLEGE } from '@/lib/registration/college';

export const dynamic = 'force-dynamic';

/**
 * Everything /stats renders.
 *
 * Two rules run through this file, and both were broken before.
 *
 * 1. **Count `success` + `comped` everywhere.** A comped registration is a real
 *    person in a real seat. The track and total figures already used
 *    OCCUPYING_STATUSES, but the year chart hand-wrote `eq(paymentStatus,
 *    'success')`, so a comp appeared in one panel and not the other.
 *
 * 2. **`failure` is not `pending`.** The old handler computed
 *    `pending = totalAll - successful`, which folded abandoned and declined
 *    payments into the pending count — 20 "pending" when 13 people were
 *    actually mid-checkout and 7 had failed. They are different problems and
 *    only one is worth chasing, so the buckets are counted, never subtracted.
 *
 * The queries are small but there are a dozen of them; they run in one
 * Promise.all rather than a dozen sequential round trips.
 */

/** Registrations that count as "in": settled successes and comps. */
const OCCUPYING = inArray(registrations.paymentStatus, [...OCCUPYING_STATUSES]);

const DAILY_WINDOW_DAYS = 10;
const TOP_COMBOS = 10;

export interface ComboRow {
  beginner: string | null;
  advanced: string | null;
  capstone: boolean;
  count: number;
}

export interface ReferrerRow {
  label: string;
  count: number;
  /** How many distinct spellings collapsed into this row. 1 means none did. */
  variants: number;
}

export async function GET(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (!auth.ok) return auth.response;

    const trackRows = await db.select().from(tracks).orderBy(tracks.sortOrder);
    const trackIds = trackRows.filter((t) => t.slug !== CAPSTONE_SLUG).map((t) => t.id);

    const [
      sold,
      capstoneSold,
      statusRows,
      skuRows,
      comboRows,
      collegeRows,
      otherCollegeRows,
      departmentRows,
      yearRows,
      dailyRaw,
      typedReferrers,
      attributedReferrers,
      revenueRow,
    ] = await Promise.all([
      soldPerTrack(db, trackIds),
      soldCapstone(db),

      // Every status, counted. `totalAll` is their sum, so nothing can hide.
      db
        .select({ status: registrations.paymentStatus, n: count(registrations.id) })
        .from(registrations)
        .groupBy(registrations.paymentStatus),

      db
        .select({ sku: registrations.sku, n: count(registrations.id) })
        .from(registrations)
        .where(OCCUPYING)
        .groupBy(registrations.sku),

      // Track ids, resolved to names in JS against the rows already fetched —
      // cheaper than two more joins for a table with seven rows in it.
      db
        .select({
          beginnerId: registrations.beginnerTrackId,
          advancedId: registrations.advancedTrackId,
          capstone: registrations.hasCapstone,
          n: count(registrations.id),
        })
        .from(registrations)
        .where(OCCUPYING)
        .groupBy(registrations.beginnerTrackId, registrations.advancedTrackId, registrations.hasCapstone)
        .orderBy(desc(count(registrations.id)))
        .limit(TOP_COMBOS),

      db
        .select({ college: registrations.college, n: count(registrations.id) })
        .from(registrations)
        .where(OCCUPYING)
        .groupBy(registrations.college),

      // Named non-NMIMS colleges. Empty until someone outside the list signs up,
      // which is why the panel that renders this hides itself when it is.
      db
        .select({ name: registrations.collegeOther, n: count(registrations.id) })
        .from(registrations)
        .where(and(OCCUPYING, isNotNull(registrations.collegeOther), ne(registrations.collegeOther, '')))
        .groupBy(registrations.collegeOther)
        .orderBy(desc(count(registrations.id))),

      db
        .select({ department: registrations.department, n: count(registrations.id) })
        .from(registrations)
        .where(OCCUPYING)
        .groupBy(registrations.department)
        .orderBy(desc(count(registrations.id))),

      db
        .select({ year: registrations.year, n: count(registrations.id) })
        .from(registrations)
        .where(OCCUPYING)
        .groupBy(registrations.year),

      db
        .select({
          day: sql<string>`to_char(date(${registrations.createdAt}), 'YYYY-MM-DD')`,
          status: registrations.paymentStatus,
          n: count(registrations.id),
        })
        .from(registrations)
        .where(sql`${registrations.createdAt} >= current_date - make_interval(days => ${DAILY_WINDOW_DAYS - 1})`)
        .groupBy(sql`date(${registrations.createdAt})`, registrations.paymentStatus),

      // The typed Referral box, normalised.
      //
      // `referrers` is empty in production, so this free text is the only record
      // of who brought whom. Grouping on the raw string reproduces the problem
      // this page exists to remove: "Akshat Malpani", "AKSHAT MALPANI" and
      // "Akshat malpani" are one person split across three rows.
      //
      // Case and internal whitespace only. Nothing merges "Shubh" into "Shubh
      // Tandon" — that is a guess, and on a leaderboard people may be paid on, a
      // wrong merge is worse than a visible split. `mode()` picks the most
      // common spelling so the row is labelled the way most people wrote it.
      db.execute<{ label: string; n: number; variants: number }>(sql`
        SELECT mode() WITHIN GROUP (ORDER BY ${registrations.referral}) AS label,
               count(*)::int AS n,
               count(DISTINCT ${registrations.referral})::int AS variants
        FROM ${registrations}
        WHERE ${OCCUPYING} AND coalesce(btrim(${registrations.referral}), '') <> ''
        GROUP BY lower(regexp_replace(btrim(${registrations.referral}), '\\s+', ' ', 'g'))
        ORDER BY n DESC, label ASC
      `),

      // Attributed through a /r/<CODE> link — authoritative, and currently empty.
      db
        .select({
          code: referrers.code,
          name: referrers.name,
          n: count(registrations.id),
        })
        .from(referrers)
        .innerJoin(registrations, and(eq(registrations.referrerId, referrers.id), OCCUPYING))
        .groupBy(referrers.id, referrers.code, referrers.name)
        .orderBy(desc(count(registrations.id))),

      db
        .select({ paise: sql<number>`coalesce(sum(${registrations.amountPaid}), 0)::bigint` })
        .from(registrations)
        .where(OCCUPYING),
    ]);

    const trackName = new Map(trackRows.map((t) => [t.id, t.name]));

    const domains: Record<string, number> = {};
    for (const t of trackRows) {
      domains[t.name] = t.slug === CAPSTONE_SLUG ? capstoneSold : (sold.get(t.id) ?? 0);
    }

    const statuses = { success: 0, comped: 0, pending: 0, failure: 0 };
    for (const row of statusRows) {
      statuses[row.status as keyof typeof statuses] = Number(row.n);
    }
    const totalAll = Object.values(statuses).reduce((a, b) => a + b, 0);
    // Registrations, not seats: a bundle occupies three track seats but is one
    // person, so summing `domains` would triple-count them.
    const occupying = statuses.success + statuses.comped;

    const skus = { capstone: 0, single: 0, bundle: 0 };
    for (const row of skuRows) skus[row.sku as keyof typeof skus] = Number(row.n);

    const combos: ComboRow[] = comboRows.map((r) => ({
      beginner: r.beginnerId ? (trackName.get(r.beginnerId) ?? null) : null,
      advanced: r.advancedId ? (trackName.get(r.advancedId) ?? null) : null,
      capstone: r.capstone,
      count: Number(r.n),
    }));

    // NMIMS vs everyone else. `college` stays categorical precisely so this is a
    // two-bucket sum rather than a guess about which strings are "known".
    let fromOther = 0;
    const colleges: Record<string, number> = {};
    for (const row of collegeRows) {
      const n = Number(row.n);
      if (row.college === OTHER_COLLEGE) fromOther += n;
      else colleges[row.college] = n;
    }

    const otherColleges: Record<string, number> = {};
    for (const row of otherCollegeRows) {
      if (row.name) otherColleges[row.name] = Number(row.n);
    }

    const departments: Record<string, number> = {};
    for (const row of departmentRows) departments[row.department] = Number(row.n);

    const years: Record<string, number> = {};
    for (const row of yearRows) years[row.year] = Number(row.n);

    // Pre-seeded so a quiet day is a zero on the axis rather than a gap.
    const daily: Record<string, { success: number; pending: number; failure: number }> = {};
    const today = new Date();
    for (let i = DAILY_WINDOW_DAYS - 1; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      daily[day.toISOString().slice(0, 10)] = { success: 0, pending: 0, failure: 0 };
    }
    for (const row of dailyRaw) {
      const bucket = daily[row.day];
      if (!bucket) continue;
      const n = Number(row.n);
      // comped counts with success; failure gets its own line instead of being
      // quietly labelled "pending" the way it used to be.
      if (row.status === 'success' || row.status === 'comped') bucket.success += n;
      else if (row.status === 'failure') bucket.failure += n;
      else bucket.pending += n;
    }

    const typed: ReferrerRow[] = (typedReferrers.rows ?? []).map((r) => ({
      label: String(r.label ?? '').trim(),
      count: Number(r.n),
      variants: Number(r.variants),
    }));

    const attributed = attributedReferrers.map((r) => ({
      code: r.code,
      name: r.name,
      count: Number(r.n),
    }));

    return NextResponse.json({
      success: true,
      // `total` stays the occupying count so nothing that reads this endpoint
      // changes meaning under it.
      total: occupying,
      totalAll,
      statuses,
      revenuePaise: Number(revenueRow[0]?.paise ?? 0),
      domains,
      skus,
      combos,
      colleges,
      fromOther,
      otherColleges,
      departments,
      years,
      daily,
      referrers: { typed, attributed },
    });
  } catch (error) {
    console.error('Stats API Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
