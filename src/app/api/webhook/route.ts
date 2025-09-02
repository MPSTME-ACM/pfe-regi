// app/api/webhook/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import qrcode from 'qrcode';
import QRCodeWithLogos from 'qrcode-with-logos';

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("x-webhook-signature");
    const timestamp = request.headers.get("x-webhook-timestamp");
    const payload = await request.text();

    if (!signature || !timestamp || !payload) {
      return NextResponse.json({ success: false, message: 'Missing webhook headers or payload' }, { status: 400 });
    }

    const dataToVerify = `${timestamp}${payload}`;
    const secretKey = process.env.CASHFREE_WEBHOOK_SECRET!;

    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(dataToVerify)
      .digest('base64');

    const isSignatureValid = (expectedSignature === signature);

    const eventData = JSON.parse(payload);
    const order = eventData.data.order;
    const payment = eventData.data.payment;

    // console.log(`Webhook received for order: ${order.order_id}, Status: ${payment.payment_status}`);
    console.debug(eventData + "webhook route");

    // --- DATABASE INTEGRATION ---
    // Update the payment status in the database based on the webhook event
    if (payment.payment_status === "SUCCESS") {
      // Generate QR code
      const qrCodeDataUrl = await qrcode.toDataURL(`https://your-event-site.com/verify?orderId=${order.order_id}`);

      // Update database
      const updateResult = await db.update(registrations)
        .set({
          paymentStatus: 'success',
          qrCodeUrl: qrCodeDataUrl
        })
        .where(eq(registrations.orderId, order.order_id));

      // console.log(`Database updated for order ${order.order_id}: SUCCESS`);
    } else if (payment.payment_status === "FAILED" || payment.payment_status === "USER_DROPPED") {
      const updateResult = await db.update(registrations)
        .set({ paymentStatus: 'failure' })
        .where(eq(registrations.orderId, order.order_id));
      // console.log(`Database updated for order ${order.order_id}: FAILURE`);
    }

    return NextResponse.json({ success: true, status: "received" });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('Error processing webhook:', errorMessage);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}