import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import qrcode from 'qrcode';
import { sendMail } from '@/lib/mail/mailUtil';
import 'dotenv/config';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(request: Request): Promise<Buffer> {
  const readableStream = request.body;
  const reader = readableStream?.getReader();
  const chunks: Uint8Array[] = [];

  if (!reader) {
    throw new Error('Unable to read request body');
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return Buffer.concat(chunks);
}

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("x-webhook-signature");
    const timestamp = request.headers.get("x-webhook-timestamp");

    if (!signature || !timestamp) {
      return NextResponse.json({ success: false, message: 'Missing webhook headers or payload' }, { status: 400 });
    }

    const rawBodyBuffer = await getRawBody(request);
    const rawBody = rawBodyBuffer.toString('utf-8');
    const dataToVerify = `${timestamp}${rawBody}`;
    const secretKey = process.env.CASHFREE_SECRET_KEY!;

    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(dataToVerify)
      .digest('base64');

    const isSignatureValid = expectedSignature === signature;
    if (!isSignatureValid) {
      console.error('Invalid webhook signature');
      return NextResponse.json(
        { success: false, message: 'Invalid webhook signature' },
        { status: 400 }
      );
    }

    const eventData = JSON.parse(rawBody);
    const { order, payment, customer_details } = eventData.data;

    // --- DATABASE INTEGRATION ---
    // Update the payment status in the database based on the webhook event
    if (payment.payment_status === "SUCCESS") {
      // Generate QR code
      const qrCodeDataUrl = await qrcode.toDataURL(`${process.env.NEXT_PUBLIC_SITE_URL}/verify?orderId=${order.order_id}`);

      // Update database
      const updateResult = await db.update(registrations)
        .set({
          paymentStatus: 'success',
          qrCodeUrl: qrCodeDataUrl
        })
        .where(eq(registrations.orderId, order.order_id));
        
        // Send out email at this stage
        const allowedDomains = {
          C: 'C',
          P: 'Python',
          W: 'Web',
          D: 'DSA',
          A: 'AIML'
        } as const;
        const domainChar = order.order_id.toString().slice(-1) as keyof typeof allowedDomains;
        const domain = allowedDomains[domainChar];

        const mail = customer_details.customer_email;
        const name = customer_details.customer_name;

        sendMail(mail, domain, name, qrCodeDataUrl);

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