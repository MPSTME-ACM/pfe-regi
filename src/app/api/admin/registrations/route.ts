import { NextResponse } from 'next/server';
import { eq, inArray, or, sql } from 'drizzle-orm';
import qrcode from 'qrcode';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { db } from '@/lib/db';
import { registrations, registrations2025, tracks } from '@/lib/db/schema';
import { trackAvailability, soldPerTrack } from '@/lib/registration/capacity';
import { sendTicketEmail } from '@/lib/registration/completeWithoutPayment';
import {
  SWAP_REJECTION_MESSAGES,
  planSwap,
  type SwapPlan,
  type SwapRejection,
} from '@/lib/registration/swapTracks';
import { siteUrl } from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────
// Admin view + edit of one registration's tracks.
//
// The swap is PRICE-NEUTRAL by construction: planSwap() (pure, in
// lib/registration/swapTracks) rejects anything that would change what was
// bought, and its plan type cannot carry sku / has_capstone / amount_paid. A
// ₹500 bundle stays a ₹500 bundle. Changing what someone bought needs a
// refund/top-up story and is deliberately not this endpoint.
//
// Capacity is checked INSIDE the swap transaction with the target track rows
// locked FOR UPDATE, reusing soldPerTrack — the same machinery api/create-order
// uses, so a swap cannot oversell what a checkout cannot.
//
// The Google Sheet needs no code here: the sync diff is keyed on Order ID and
// rewrites the track columns on the next run (≤10 min). Say that in the UI.
// ─────────────────────────────────────────────────────────────────────────────

const userAgent = (request: Request) => request.headers.get('user-agent') ?? 'unknown';

function reject(request: Request, message: string, status: number) {
  // A silent 401 cost two days of stopped sheet syncs in August 2026. Every
  // rejection on this route says why and who asked, in the container log.
  console.log(`[admin/registrations] ${status} — ${message} (ua: ${userAgent(request)})`);
  return NextResponse.json({ success: false, message }, { status });
}

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

// ─── GET ─────────────────────────────────────────────────────────────────────

/** What the UI renders for one row. Money stays integer paise. */
export interface RegistrationView {
  orderId: string;
  name: string;
  email: string;
  sku: string | null;
  beginnerTrackId: number | null;
  advancedTrackId: number | null;
  hasCapstone: boolean;
  amountPaid: number;
  paymentStatus: string | null;
  emailSentAt: string | null;
  createdAt: string | null;
  /** "Web Dev + DSA + Capstone Day", resolved from the tracks table. */
  description: string;
  attendance: Record<string, boolean>;
  /** 2026 rows are editable; the 2025 archive never is. */
  editable: boolean;
}

async function viewForRow(row: typeof registrations.$inferSelect): Promise<RegistrationView> {
  const ids = [row.beginnerTrackId, row.advancedTrackId].filter((n): n is number => n !== null);
  const filters = [
    ids.length ? inArray(tracks.id, ids) : undefined,
    row.hasCapstone ? eq(tracks.slug, 'capstone') : undefined,
  ].filter((f): f is NonNullable<typeof f> => f !== undefined);

  const picked = filters.length
    ? await db.select().from(tracks).where(filters.length === 1 ? filters[0] : or(...filters))
    : [];
  const names: string[] = [];
  for (const id of ids) {
    const t = picked.find((p) => p.id === id);
    if (t) names.push(t.name);
  }
  if (row.hasCapstone) {
    names.push(picked.find((p) => p.slug === 'capstone')?.name ?? 'Capstone Day');
  }

  return {
    orderId: row.orderId,
    name: row.name,
    email: row.email,
    sku: row.sku,
    beginnerTrackId: row.beginnerTrackId,
    advancedTrackId: row.advancedTrackId,
    hasCapstone: row.hasCapstone,
    amountPaid: row.amountPaid,
    paymentStatus: row.paymentStatus,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    description: names.join(' + ') || row.sku,
    attendance: row.attendance ?? {},
    editable: true,
  };
}

export async function GET(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return reject(request, 'Authorization required', 401);

  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId')?.trim() || '';
  const email = url.searchParams.get('email')?.trim() || '';
  if (!orderId && !email) {
    return bad('Give an order ID or an email');
  }

  try {
    let matches: RegistrationView[] = [];

    if (orderId) {
      // Live table first, archive second — the lookupTicket() rule. An orderId
      // is OPAQUE: matched exactly, never parsed.
      const [row] = await db
        .select()
        .from(registrations)
        .where(eq(registrations.orderId, orderId))
        .limit(1);
      if (row) {
        matches = [await viewForRow(row)];
      } else {
        const [archived] = await db
          .select()
          .from(registrations2025)
          .where(eq(registrations2025.orderId, orderId))
          .limit(1);
        if (archived) {
          matches = [
            {
              orderId: archived.orderId,
              name: archived.name,
              email: archived.email,
              sku: null,
              beginnerTrackId: null,
              advancedTrackId: null,
              hasCapstone: false,
              amountPaid: 0,
              paymentStatus: archived.paymentStatus,
              emailSentAt: null,
              createdAt: archived.createdAt?.toISOString() ?? null,
              description: archived.domain || '2025 registration',
              attendance: {},
              editable: false,
            },
          ];
        }
      }
    } else {
      // Email can match several rows (people re-register). All of them, newest
      // first; the UI makes the admin pick one by order ID.
      const rows = await db
        .select()
        .from(registrations)
        .where(sql`lower(${registrations.email}) = lower(${email})`)
        // Secondary id sort: two rows inserted in one statement share a
        // created_at, and without a tiebreak the "newest first" order flips
        // between calls.
        .orderBy(sql`${registrations.createdAt} desc, ${registrations.id} desc`)
        .limit(20);
      matches = await Promise.all(rows.map(viewForRow));
    }

    return NextResponse.json({
      success: true,
      matches,
      tracks: await trackAvailability(),
    });
  } catch (error) {
    console.error('[admin/registrations] lookup failed:', error);
    return bad('Lookup failed', 500);
  }
}

// ─── PATCH — the swap ────────────────────────────────────────────────────────

function parsePatch(body: unknown):
  | { orderId: string; beginnerTrackId?: number; advancedTrackId?: number }
  | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'body must be a JSON object';
  }
  const o = body as Record<string, unknown>;
  if (typeof o.orderId !== 'string' || !o.orderId.trim()) return 'orderId is required';

  const out: { orderId: string; beginnerTrackId?: number; advancedTrackId?: number } = {
    orderId: o.orderId.trim(),
  };
  for (const key of ['beginnerTrackId', 'advancedTrackId'] as const) {
    if (o[key] === undefined || o[key] === null) continue;
    if (!Number.isInteger(o[key])) return `${key} must be an integer track id`;
    out[key] = o[key] as number;
  }
  if (out.beginnerTrackId === undefined && out.advancedTrackId === undefined) {
    return 'Give beginnerTrackId and/or advancedTrackId';
  }
  return out;
}

const SWAP_STATUS: Record<SwapRejection, number> = {
  UNKNOWN_TRACK: 400,
  DISABLED_TRACK: 400,
  SEGMENT_MISMATCH: 400,
  EMPTY_SLOT: 400,
  NO_SLOTS: 400,
  NOTHING_REQUESTED: 400,
  NO_CHANGE: 400,
};

export async function PATCH(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return reject(request, 'Authorization required', 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('Invalid JSON body');
  }
  const parsed = parsePatch(body);
  if (typeof parsed === 'string') return bad(parsed);

  try {
    const outcome = await db.transaction(async (tx) => {
      // Lock the row first: a webhook flipping paymentStatus mid-swap, or two
      // admins swapping the same order, serialise behind this lock.
      const [row] = await tx
        .select()
        .from(registrations)
        .where(eq(registrations.orderId, parsed.orderId))
        .for('update')
        .limit(1);
      if (!row) return { kind: 'missing' } as const;

      // The full roster goes to the planner (it resolves current tracks for the
      // before/after text and the attendance dates); only the TARGETS are
      // locked — that is what serialises the seats being contended.
      const roster = await tx.select().from(tracks);
      const targetIds = [
        ...new Set(
          [parsed.beginnerTrackId, parsed.advancedTrackId].filter(
            (n): n is number => n !== undefined,
          ),
        ),
      ];
      const locked = targetIds.length
        ? await tx.select().from(tracks).where(inArray(tracks.id, targetIds)).for('update')
        : [];

      const planned = planSwap(row, roster, {
        beginnerTrackId: parsed.beginnerTrackId,
        advancedTrackId: parsed.advancedTrackId,
      });
      if (!planned.ok) {
        return {
          kind: 'rejected',
          rejection: planned.rejection,
          trackName: planned.trackName,
        } as const;
      }

      // Segment rules already guarantee each target is a real enabled track of
      // its slot's segment — so this row cannot already occupy one through the
      // other slot, and its own seat cannot double-count against the cap.
      // The capstone needs no check: has_capstone is never written here.
      const sold = await soldPerTrack(
        tx,
        locked.filter((t) => t.slug !== 'capstone').map((t) => t.id),
      );
      for (const t of locked) {
        if (t.slug === 'capstone') continue;
        const used = sold.get(t.id) ?? 0;
        if (used >= t.capacity) return { kind: 'full', name: t.name } as const;
      }

      // planSwap's type cannot carry sku / hasCapstone / amountPaid — the
      // write below is structurally incapable of changing what was paid.
      await tx
        .update(registrations)
        .set({
          ...(planned.plan.beginnerTrackId !== undefined && {
            beginnerTrackId: planned.plan.beginnerTrackId,
          }),
          ...(planned.plan.advancedTrackId !== undefined && {
            advancedTrackId: planned.plan.advancedTrackId,
          }),
          attendance: planned.plan.attendance,
        })
        .where(eq(registrations.id, row.id));

      return { kind: 'ok', plan: planned.plan, row } as const;
    });

    if (outcome.kind === 'missing') {
      return bad('No registration with that order ID', 404);
    }
    if (outcome.kind === 'full') {
      return bad(`${outcome.name} is full — capacity is checked live inside the swap.`, 409);
    }
    if (outcome.kind === 'rejected') {
      const base = SWAP_REJECTION_MESSAGES[outcome.rejection];
      const message = outcome.trackName ? `${outcome.trackName}: ${base}` : base;
      return bad(message, SWAP_STATUS[outcome.rejection]);
    }

    const plan = outcome.plan as SwapPlan;
    const orderId = outcome.row.orderId;
    console.log(
      `[admin/registrations] swap ${orderId} — ${plan.before} → ${plan.after}` +
        (plan.addedDates.length ? ` · attendance +${plan.addedDates.join(',')}` : '') +
        ` (ua: ${userAgent(request)})`,
    );

    // Re-read after the commit: `outcome.row` predates the update, so its track
    // ids would render the OLD selection as the result.
    const [fresh] = await db.select().from(registrations).where(eq(registrations.orderId, orderId)).limit(1);
    if (!fresh) return bad('Swap committed but the row could not be re-read', 500);

    return NextResponse.json({
      success: true,
      registration: await viewForRow(fresh),
      addedDates: plan.addedDates,
      // Re-read after the commit: the swap freed seats on the old tracks.
      tracks: await trackAvailability(),
    });
  } catch (error) {
    console.error('[admin/registrations] swap failed:', error);
    return bad('Swap failed', 500);
  }
}

// ─── POST — resend the ticket email ──────────────────────────────────────────
// The confirmation email is stale the moment a swap lands. sendTicketEmail()
// already assembles the new tracks and stamps email_sent_at; this is just the
// endpoint in front of it. Never throws: a send failure surfaces as
// success:false with the row left as-is, which the admin panel can see.

export async function POST(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return reject(request, 'Authorization required', 401);

  let body: { orderId?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad('Invalid JSON body');
  }
  if (body.action !== 'resend-ticket') return bad('Unknown action');
  if (typeof body.orderId !== 'string' || !body.orderId.trim()) return bad('orderId is required');
  const orderId = body.orderId.trim();

  try {
    const [row] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.orderId, orderId))
      .limit(1);
    if (!row) return bad('No live registration with that order ID', 404);

    let qr = row.qrCodeUrl;
    if (!qr) {
      // A row can be settled without a QR (manual-payment fixes do this). The
      // email needs one, so generate and persist it — same data URL shape the
      // webhook stores.
      qr = await qrcode.toDataURL(`${siteUrl()}/verify?orderId=${orderId}`);
      await db.update(registrations).set({ qrCodeUrl: qr }).where(eq(registrations.id, row.id));
    }

    await sendTicketEmail(orderId, qr);

    const [after] = await db
      .select({ emailSentAt: registrations.emailSentAt })
      .from(registrations)
      .where(eq(registrations.id, row.id));

    if (!after?.emailSentAt) {
      return bad('Sending failed — emailSentAt is still null. Check the container log.', 502);
    }
    console.log(
      `[admin/registrations] resend-ticket ${orderId} (ua: ${userAgent(request)})`,
    );
    return NextResponse.json({
      success: true,
      emailSentAt: after.emailSentAt.toISOString(),
    });
  } catch (error) {
    console.error('[admin/registrations] resend-ticket failed:', error);
    return bad('Resend failed', 500);
  }
}
