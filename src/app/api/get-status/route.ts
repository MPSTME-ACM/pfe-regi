// app/api/get-status/route.ts
import { NextResponse } from 'next/server';
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { lookupTicket, type TicketView } from '@/lib/registration/lookupTicket';

// Initialize Cashfree with the same credentials and environment as your create-order route
const cashfreeEnvironment = process.env.CASHFREE_ENV === 'PRODUCTION'
  ? CFEnvironment.PRODUCTION
  : CFEnvironment.SANDBOX;

const cashfree = new Cashfree(
  cashfreeEnvironment,
  process.env.CASHFREE_APP_ID!,
  process.env.CASHFREE_SECRET_KEY!
);

/**
 * What the ticket screen is allowed to see.
 *
 * This endpoint is UNAUTHENTICATED — anyone holding an order id can call it — so
 * the payload is whitelisted here rather than spread from the row. Contact
 * details deliberately never leave the server through this route.
 */
function publicDetails(view: TicketView) {
  return {
    edition: view.edition,
    name: view.name,
    description: view.description,
    sku: view.sku,
    course: view.course,
    year: view.year,
    orderId: view.orderId,
    qrCodeUrl: view.qrCodeUrl,
  };
}

/** 2025 rows recorded the gateway's own wording; treat either spelling as paid. */
function archivePaid(status: string | null): boolean {
  const s = (status ?? '').toLowerCase();
  return s === 'success' || s === 'paid' || s === 'comped';
}

export async function POST(request: Request) {
  try {
    const { order_id } = await request.json();

    if (!order_id) {
      return NextResponse.json({ success: false, message: 'Order ID is required' }, { status: 400 });
    }

    let payments;
    try {
      const res = await cashfree.PGOrderFetchPayments(order_id);
      payments = res.data;
    } catch (gatewayError) {
      // A 2025 order id may no longer exist at the gateway at all. Those tickets
      // are settled history: if the archive says it was paid, show it rather than
      // 500-ing at someone holding a valid old QR code. Live 2026 orders keep the
      // old behaviour — the gateway, not the database, decides whether they paid.
      const archived = await lookupTicket(order_id);
      if (archived?.view.edition === 2025 && archivePaid(archived.view.paymentStatus)) {
        return NextResponse.json({
          success: true,
          status: 'Success',
          details: publicDetails(archived.view),
        });
      }
      throw gatewayError;
    }

    const paymentData = payments;

    let registrationDetails = null;

    let orderStatus = "Failure";

    if (paymentData && paymentData.length > 0) {
      const successTx = paymentData.find(tx => tx.payment_status === "SUCCESS");
      if (successTx) {
        orderStatus = "Success";
        // Falls back to the read-only 2025 archive: those rows were moved out of
        // the live table by migration 0007, so a 2025 ticket misses here first.
        const found = await lookupTicket(order_id);
        if (found) registrationDetails = publicDetails(found.view);
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
