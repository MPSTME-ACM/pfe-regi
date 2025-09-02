import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';

export async function GET() {
    try {
        // Query the database to count successful registrations, grouped by domain
        const result = await db
            .select({
                domain: registrations.domain,
                count: count(registrations.id),
            })
            .from(registrations)
            .where(eq(registrations.paymentStatus, 'success'))
            .groupBy(registrations.domain);

        // Convert the database result into a simple { domain: count } object
        const domainCounts = result.reduce((acc, row) => {
            if (row.domain) {
                acc[row.domain] = row.count;
            }
            return acc;
        }, {} as Record<string, number>);

        const allDomains = ['C', 'Python', 'Web', 'DSA', 'AIML'];
        const finalCounts = allDomains.reduce((acc, domain) => {
            acc[domain] = domainCounts[domain] || 0;
            return acc;
        }, {} as Record<string, number>);

        return NextResponse.json({ success: true, counts: finalCounts });

    } catch (error) {
        console.error('Failed to fetch domain counts:', error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
