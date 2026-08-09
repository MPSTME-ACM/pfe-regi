import { db } from '@/lib/db';
import { registrations, tracks } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import qrcode from 'qrcode';
import { sendMail } from '@/lib/mail/mailUtil';

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

  await sendTicketEmail(orderId, qrCodeUrl);
}

/**
 * Send the ticket and record that we did.
 *
 * Deliberately never throws. A registration is already paid (or comped) by the
 * time this runs; letting an SMTP blip bubble up would turn a completed payment
 * into a 500. `emailSentAt` stays null instead, which is the signal the admin
 * panel uses to find people who paid and got no ticket.
 */
export async function sendTicketEmail(orderId: string, qrCodeUrl: string): Promise<void> {
  try {
    const [row] = await db.select().from(registrations).where(eq(registrations.orderId, orderId)).limit(1);
    if (!row) return;

    const ids = [row.beginnerTrackId, row.advancedTrackId].filter((n): n is number => n !== null);
    const picked = ids.length ? await db.select().from(tracks).where(inArray(tracks.id, ids)) : [];

    const names = picked.map((t) => t.name);
    if (row.hasCapstone) names.push('Capstone Day');
    // The email template still takes a single "domain" string; phase 2's email
    // stream replaces this with a structured payload.
    const description = names.join(' + ') || row.sku;

    await sendMail(row.email, description, row.name, qrCodeUrl, orderId);
    await db
      .update(registrations)
      .set({ emailSentAt: new Date() })
      .where(eq(registrations.orderId, orderId));
  } catch (error) {
    console.error(`[ticket-email] failed for ${orderId} — emailSentAt left null:`, error);
  }
}
