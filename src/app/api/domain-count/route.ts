import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq, count, and } from 'drizzle-orm';

export async function GET() {
    try {
        const allDomains = ['C', 'Python', 'Web', 'DSA', 'AIML'];
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

        return NextResponse.json({
            success: true,
            registrationAllowed
        });

    } catch (error) {
        return NextResponse.json(
            { success: false, message: 'Internal Server Error' },
            { status: 500 }
        );
    }
}
