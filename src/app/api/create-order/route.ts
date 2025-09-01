// app/api/create-order/route.ts
import { NextResponse } from 'next/server';
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';

// IMPORTANT: Ensure your .env.local file is set up
// NEXT_PUBLIC_CASHFREE_APP_ID=YOUR_APP_ID
// NEXT_PUBLIC_CASHFREE_SECRET_KEY=YOUR_SECRET_KEY
// CASHFREE_ENV=SANDBOX or PRODUCTION
// CASHFREE_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET

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
    const formData = await request.json();
    console.log('API Route Received FormData:', formData);

    // Uses user's contact number and the current timestamp.
    const orderId = `PFE-${formData.contact}-${Date.now().toString().slice(-4)}`;

    await db.insert(registrations).values({
        name: formData.name,
        email: formData.email,
        contact: formData.contact,
        course: formData.course,
        department: formData.department,
        year: formData.year,
        domain: formData.domain,
        orderId: orderId,
        paymentStatus: 'pending',
    });

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const cashfreeRequest = {
      order_id: orderId,
      order_amount: 100.00,
      order_currency: "INR",
      customer_details: {
        customer_id: `customer_${formData.contact}`,
        customer_name: formData.name,
        customer_email: formData.email,
        customer_phone: formData.contact,
      },
      order_meta: {
        // The return_url now correctly points to your local http server
        return_url: `${baseUrl}/payment-status?order_id=${orderId}`,
        notify_url: `${baseUrl}/api/webhook`,
      },
      order_note: `Registration for PFE Workshop - ${formData.domain}`,
    };

    const order = await cashfree.PGCreateOrder(cashfreeRequest);
    const paymentSessionId = order.data.payment_session_id;

    return NextResponse.json({ 
        success: true, 
        payment_session_id: paymentSessionId 
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('Cashfree API Error:', errorMessage);
    const cfError = error as { response?: { data?: { message?: string } } };
    const message = cfError.response?.data?.message || 'Internal Server Error';
    return NextResponse.json({ 
        success: false, 
        message
    }, { status: 500 });
  }
}