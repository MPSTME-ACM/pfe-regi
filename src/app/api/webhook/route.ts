import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import qrcode from 'qrcode';
import { sendTicketEmail } from '@/lib/registration/completeWithoutPayment';
import 'dotenv/config';

export const config = { api: { bodyParser: false } };

/** Signature verification needs the bytes exactly as sent — do not add any
 *  parsing ahead of this. */
async function getRawBody(request: Request): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Unable to read request body');
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('x-webhook-signature');
    const timestamp = request.headers.get('x-webhook-timestamp');
    if (!signature || !timestamp) {
      return NextResponse.json({ success: false, message: 'Missing webhook headers' }, { status: 400 });
    }

    const rawBody = (await getRawBody(request)).toString('utf-8');
    const expected = crypto
      .createHmac('sha256', process.env.CASHFREE_SECRET_KEY!)
      .update(`${timestamp}${rawBody}`)
      .digest('base64');

    if (expected !== signature) {
      console.error('[webhook] invalid signature');
      return NextResponse.json({ success: false, message: 'Invalid webhook signature' }, { status: 400 });
    }

    const { order, payment } = JSON.parse(rawBody).data;
    const orderId: string = order.order_id;

    // Read the row. 2025 reconstructed the track from `order_id.slice(-1)`,
    // which broke as soon as comped orders gained an `-ACM` suffix and produced
    // "Welcome to the undefined track" in every one of those emails. Order IDs
    // are opaque now; the database is the only source of truth.
    const [row] = await db.select().from(registrations).where(eq(registrations.orderId, orderId)).limit(1);
    if (!row) {
      // 200, not 404: making Cashfree retry an order we do not have helps nobody.
      console.error(`[webhook] no registration for ${orderId}`);
      return NextResponse.json({ success: true, status: 'ignored' });
    }

    if (payment.payment_status === 'SUCCESS') {
      // ── Idempotency ────────────────────────────────────────────────────────
      // Cashfree retries on timeout and on any non-2xx. Without this guard a
      // retry re-sends the ticket email, and the only thing that ever stopped it
      // was an in-process Map that does nothing across two containers.
      if (row.paymentStatus === 'success' || row.paymentStatus === 'comped') {
        return NextResponse.json({ success: true, status: 'already_processed' });
      }

      // The amount is server-computed and stored at order creation. If what was
      // actually paid disagrees, refuse rather than issue a ticket for the
      // wrong money.
      const paidPaise = Math.round(Number(payment.payment_amount) * 100);
      if (Number.isFinite(paidPaise) && paidPaise !== row.amountPaid) {
        console.error(
          `[webhook] amount mismatch for ${orderId}: expected ${row.amountPaid} paise, paid ${paidPaise}`,
        );
        return NextResponse.json({ success: false, message: 'Amount mismatch' }, { status: 400 });
      }

      const qrCodeUrl = await qrcode.toDataURL(
        `${process.env.NEXT_PUBLIC_SITE_URL}/verify?orderId=${orderId}`,
      );
      await db
        .update(registrations)
        .set({ paymentStatus: 'success', qrCodeUrl })
        .where(eq(registrations.orderId, orderId));

      // Awaited but never throwing: the payment is already recorded, so an SMTP
      // failure must not become a 500 that makes Cashfree retry a completed
      // order. It leaves emailSentAt null for the admin panel to pick up.
      await sendTicketEmail(orderId, qrCodeUrl);

      return NextResponse.json({ success: true, status: 'received' });
    }

    if (payment.payment_status === 'FAILED' || payment.payment_status === 'USER_DROPPED') {
      // Never downgrade a completed registration on a late failure callback.
      if (row.paymentStatus === 'pending') {
        await db
          .update(registrations)
          .set({ paymentStatus: 'failure' })
          .where(eq(registrations.orderId, orderId));
      }
    }

    return NextResponse.json({ success: true, status: 'received' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[webhook]', message);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
