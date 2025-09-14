import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { and, eq, count } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const formData = await request.json();

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

    if (currentDomainCount >= 120) {
      return NextResponse.json({
        success: false,
        message: `Sorry, the ${formData.domain} domain is full. Please choose a different domain.`,
        error: 'DOMAIN_FULL'
      }, { status: 400 });
    }

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
    const orderId = `${firstInitial}${lastInitial}${formData.contact.slice(-4)}${Date.now().toString().slice(-5)}${formData.domain.charAt(0).toUpperCase()}-ACM`;

    await db.insert(registrations).values({
      name: `ACM - ${formData.name}`,
      email: formData.email,
      contact: formData.contact,
      course: formData.course,
      department: formData.department,
      year: formData.year,
      domain: formData.domain,
      orderId: orderId,
      paymentStatus: 'failure',
    });

    return NextResponse.json({
      success: true,
      order_id: orderId
    });

  } catch (error) {
    const cfError = error as { response?: { data?: { message?: string } } };
    const message = cfError.response?.data?.message || 'Internal Server Error';
    return NextResponse.json({
      success: false,
      message
    }, { status: 500 });
  }
}