// app/api/get-status/route.ts
import { NextResponse } from 'next/server';
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Initialize Cashfree with the same credentials and environment as your create-order route
const cashfreeEnvironment = process.env.CASHFREE_ENV === 'PRODUCTION'
  ? CFEnvironment.PRODUCTION
  : CFEnvironment.SANDBOX;

const cashfree = new Cashfree(
  cashfreeEnvironment,
  process.env.CASHFREE_APP_ID!,
  process.env.CASHFREE_SECRET_KEY!
);

export async function POST(request: Request) {
  try {
    const { order_id } = await request.json();

    if (!order_id) {
      return NextResponse.json({ success: false, message: 'Order ID is required' }, { status: 400 });
    }

    const payments = await cashfree.PGOrderFetchPayments(order_id);
    const paymentData = payments.data;

    let registrationDetails = null;

    let orderStatus = "Failure";

    if (paymentData && paymentData.length > 0) {
      const successTx = paymentData.find(tx => tx.payment_status === "SUCCESS");
      if (successTx) {
        orderStatus = "Success";
        const result = await db.select().from(registrations).where(eq(registrations.orderId, order_id));
        if (result.length > 0) {
          const dbRecord = result[0];
          registrationDetails = {
            name: dbRecord.name,
            domain: dbRecord.domain,
            orderId: dbRecord.orderId,
            qrCodeUrl: dbRecord.qrCodeUrl
          }
        }
      } else {
        const pendingTx = paymentData.find(tx => tx.payment_status === "PENDING");
        if (pendingTx) {
          orderStatus = "Pending";
        }
      }
    }

    return NextResponse.json({
      success: true,
      status: orderStatus,
      details: registrationDetails
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('Error fetching payment status:', errorMessage);
    const cfError = error as { response?: { data?: { message?: string } } };
    const message = cfError.response?.data?.message || 'Internal Server Error';
    return NextResponse.json({
      success: false,
      message
    }, { status: 500 });
  }
}