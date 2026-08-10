import { db } from '@/lib/db';
import { registrations, tracks } from '@/lib/db/schema';
import { eq, inArray, or, type SQL } from 'drizzle-orm';
import qrcode from 'qrcode';
import { sendMail, type TicketItem } from '@/lib/mail/mailUtil';
import { CAPSTONE_SLUG } from '@/lib/registration/capacity';
import { burnRedemption } from '@/lib/registration/coupons';
import { getSettings } from '@/lib/settings';

/**
 * Finish a registration that never touches the payment gateway.
 *
 * Two callers need this and they used to be separate copies of the same code:
 *   - comped ACM members (api/member-register wrote them directly)
 *   - a 100%-off coupon, where the order is ₹0 and Cashfree cannot accept it
 *
 * Marked `comped`, not `success`. 2025 wrote comps as `failure` so they would
 * dodge the capacity check, which made them indistinguishable from real payment
 * failures and quietly skewed every percentage on /stats.
 */
export async function completeWithoutPayment(orderId: string): Promise<void> {
  const [row] = await db.select().from(registrations).where(eq(registrations.orderId, orderId)).limit(1);
  if (!row) throw new Error(`completeWithoutPayment: no registration for ${orderId}`);
  if (row.paymentStatus === 'success' || row.paymentStatus === 'comped') return; // idempotent

  const qrCodeUrl = await qrcode.toDataURL(
    `${process.env.NEXT_PUBLIC_SITE_URL}/verify?orderId=${orderId}`,
  );

  await db
    .update(registrations)
    .set({ paymentStatus: 'comped', qrCodeUrl })
    .where(eq(registrations.orderId, orderId));

  // A 100%-off coupon never reaches the gateway, so no webhook ever fires for
  // it. Without this its reservation would simply lapse and the code would come
  // back to life — a single-use code redeemable twice.
  await burnRedemption(orderId);

  await sendTicketEmail(orderId, qrCodeUrl);
}

/**
 * Send the ticket and record that we did.
 *
 * Deliberately never throws. A registration is already paid (or comped) by the
 * time this runs; letting an SMTP blip bubble up would turn a completed payment
 * into a 500. `emailSentAt` stays null instead, which is the signal the admin
 * panel uses to find people who paid and got no ticket.
 *
 * The signature is intentionally unchanged — `api/webhook` calls this, and that
 * file is owned by the human thread. Everything the new structured email needs
 * (the tracks, their dates, settings.eventConfig) is assembled in here.
 */
export async function sendTicketEmail(orderId: string, qrCodeUrl: string): Promise<void> {
  try {
    const [row] = await db.select().from(registrations).where(eq(registrations.orderId, orderId)).limit(1);
    if (!row) return;

    // One query for both the bought tracks and the capstone day. The capstone is
    // a boolean on the row rather than an FK, so its dates have to be looked up
    // by slug — but not in a second round trip.
    const ids = [row.beginnerTrackId, row.advancedTrackId].filter((n): n is number => n !== null);
    const filters: SQL[] = [];
    if (ids.length) filters.push(inArray(tracks.id, ids));
    if (row.hasCapstone) filters.push(eq(tracks.slug, CAPSTONE_SLUG));
    const picked = filters.length
      ? await db.select().from(tracks).where(or(...filters))
      : [];
    const byId = new Map(picked.map((t) => [t.id, t]));

    // Programme order: beginner days, then advanced days, then the capstone.
    const items: TicketItem[] = [];
    const beginner = row.beginnerTrackId === null ? undefined : byId.get(row.beginnerTrackId);
    if (beginner) items.push({ name: beginner.name, segment: 'beginner', dates: beginner.dates });
    const advanced = row.advancedTrackId === null ? undefined : byId.get(row.advancedTrackId);
    if (advanced) items.push({ name: advanced.name, segment: 'advanced', dates: advanced.dates });
    if (row.hasCapstone) {
      // Fall back rather than throw: a missing capstone row must not cost a paid
      // registrant their ticket email.
      const capstone = picked.find((t) => t.slug === CAPSTONE_SLUG);
      items.push({
        name: capstone?.name ?? 'Capstone Day',
        segment: 'capstone',
        dates: capstone?.dates ?? [],
      });
    }

    // Dates, venue and contacts come from the admin panel, not from the template.
    const settings = await getSettings();

    await sendMail({
      to: row.email,
      name: row.name,
      orderId,
      sku: row.sku,
      items,
      qrUrl: qrCodeUrl,
      event: settings.eventConfig,
    });
    await db
      .update(registrations)
      .set({ emailSentAt: new Date() })
      .where(eq(registrations.orderId, orderId));
  } catch (error) {
    console.error(`[ticket-email] failed for ${orderId} — emailSentAt left null:`, error);
  }
}
