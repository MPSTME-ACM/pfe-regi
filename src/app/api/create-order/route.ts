// app/api/create-order/route.ts
import { NextResponse } from 'next/server';
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { and, eq, count } from 'drizzle-orm';

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
    const formData = await request.json();
    // console.log('API Route Received FormData:', formData);

    // Uses user's contact number and the current timestamp.
    const now = new Date();

    const domainCheckQuery = await db
      .select({ count: count(registrations.id) })
      .from(registrations)
      .where(
        and(
          eq(registrations.domain, formData.domain),
          eq(registrations.paymentStatus, 'success')
        )
      );

    const currentDomainCount = domainCheckQuery[0]?.count || 0;

    if (currentDomainCount >= 60) {
      return NextResponse.json({
        success: false,
        message: `Sorry, the ${formData.domain} domain is full. Please choose a different domain.`,
        error: 'DOMAIN_FULL'
      }, { status: 400 });
    }

    // Convert to IST (UTC +5:30)
    const offset = 5.5 * 60; // 5 hours 30 minutes
    const ISTDate = new Date(now.getTime() + offset * 60000);

    // Format current date and hour
    const currentDate = ISTDate.getDate().toString().padStart(2, '0');
    const currentHour = ISTDate.getHours().toString().padStart(2, '0');

    // Extract first name and last name initials
    const [firstName, lastName] = formData.name.split(' ');

    // Get the first letter of the first and last name (if last name exists)
    const firstInitial = firstName.charAt(0).toUpperCase();
    const lastInitial = lastName ? lastName.charAt(0).toUpperCase() : '';

    const allowedDomains = ['C', 'Python', 'Web', 'DSA', 'AIML'];
    if (!allowedDomains.includes(formData.domain)) {
      return NextResponse.json({
        success: false,
        message: `Sorry, the ${formData.domain} domain is invalid.`,
        error: 'DOMAIN_INVALID'
      }, { status: 400 });
    }
    // Combine the initials and other data
    const orderId = `${firstInitial}${lastInitial}${formData.contact.slice(-4)}${currentDate}${currentHour}${formData.domain.charAt(0).toUpperCase()}`;

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
      referral: formData.referral,
    });

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const cashfreeRequest = {
      order_id: orderId,
      order_amount: parseFloat(process.env.ORDER_AMOUNT!),
      order_currency: "INR",
      customer_details: {
        customer_id: `customer_${formData.contact}`,
        customer_name: formData.name,
        customer_email: formData.email,
        customer_phone: formData.contact,
      },
      order_meta: {
        notify_url: `${baseUrl}/api/webhook`,
      },
      order_note: `Registration for PFE Workshop - ${formData.domain}`,
    };

    const order = await cashfree.PGCreateOrder(cashfreeRequest);
    const paymentSessionId = order.data.payment_session_id;

    return NextResponse.json({
      success: true,
      payment_session_id: paymentSessionId,
      order_id: orderId
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