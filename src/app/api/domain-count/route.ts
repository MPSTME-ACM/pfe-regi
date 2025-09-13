import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq, count, and } from 'drizzle-orm';

const allDomains = ['C', 'Python', 'Web', 'DSA', 'AIML'];

// Simple in-memory cache
let cachedData: {
  registrationAllowed: Record<string, boolean>;
  timestamp: number;
} | null = null;

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  const now = Date.now();

  // Serve cached response if it's still valid
  if (cachedData && now - cachedData.timestamp < CACHE_DURATION) {
    return NextResponse.json({
      success: true,
      registrationAllowed: cachedData.registrationAllowed,
      cached: true,
    });
  }

  try {
    const registrationAllowed: Record<string, boolean> = {};

    for (const domain of allDomains) {
      const domainCheckQuery = await db
        .select({ count: count(registrations.id) })
        .from(registrations)
        .where(
          and(
            eq(registrations.domain, domain),
            eq(registrations.paymentStatus, 'success')
          )
        );

      const currentDomainCount = domainCheckQuery[0]?.count || 0;
      registrationAllowed[domain] = currentDomainCount < 60;
    }

    // Save to cache
    cachedData = {
      registrationAllowed,
      timestamp: now,
    };

    return NextResponse.json({
      success: true,
      registrationAllowed,
      cached: false,
    });

  } catch (error) {
    return NextResponse.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
