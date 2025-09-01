// app/api/get-status/route.ts
import { NextResponse } from 'next/server';
import { Cashfree, CFEnvironment } from "cashfree-pg";

// Initialize Cashfree with the same credentials and environment as your create-order route
const cashfreeEnvironment = process.env.CASHFREE_ENV === 'PRODUCTION' 
    ? CFEnvironment.PRODUCTION 
    : CFEnvironment.SANDBOX;

const cashfree = new Cashfree(
    cashfreeEnvironment,
    process.env.NEXT_PUBLIC_CASHFREE_APP_ID!,
    process.env.NEXT_PUBLIC_CASHFREE_SECRET_KEY!
);

export async function POST(request: Request) {
  try {
    const { order_id } = await request.json();
    console.log(order_id + " get-status req");

    if (!order_id) {
      return NextResponse.json({ success: false, message: 'Order ID is required' }, { status: 400 });
    }

    const payments = await cashfree.PGOrderFetchPayments(order_id);
    const paymentData = payments.data;

    let orderStatus = "Failure"; 

    if (paymentData && paymentData.length > 0) {
        const successTx = paymentData.find(tx => tx.payment_status === "SUCCESS");
        if (successTx) {
            orderStatus = "Success";
            console.log("payment success get-status");
        } else {
            const pendingTx = paymentData.find(tx => tx.payment_status === "PENDING");
            if (pendingTx) {
                orderStatus = "Pending";
                console.log("payment pending get-status");
            }
        }
    }

    return NextResponse.json({ 
        success: true, 
        status: orderStatus,
        details: paymentData 
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