import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq, count, and, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function GET(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (!auth.ok) return auth.response;

    // 2. Domain-wise successful registrations
    const allDomains = ['C', 'Python', 'Web', 'DSA', 'AIML'];
    const domainStats: Record<string, number> = {};
    let totalSuccess = 0;

    for (const domain of allDomains) {
      const result = await db
        .select({ count: count(registrations.id) })
        .from(registrations)
        .where(
          and(
            eq(registrations.domain, domain),
            eq(registrations.paymentStatus, "success")
          )
        );

      const domainCount = Number(result[0]?.count || 0);
      domainStats[domain] = domainCount;
      totalSuccess += domainCount;
    }

    // 3. Total registrations (all statuses)
    const totalRes = await db
      .select({ count: count(registrations.id) })
      .from(registrations);

    const totalRegistrations = Number(totalRes[0]?.count || 0);
    const pending = totalRegistrations - totalSuccess;

    const successPercent = totalRegistrations > 0 ? Number(((totalSuccess / totalRegistrations) * 100).toFixed(1)) : 0;
    const pendingPercent = totalRegistrations > 0 ? Number(((pending / totalRegistrations) * 100).toFixed(1)) : 0;

    // 4. Year-wise successful registrations
    const yearResult = await db
      .select({
        year: registrations.year,
        count: count(registrations.id),
      })
      .from(registrations)
      .where(eq(registrations.paymentStatus, "success"))
      .groupBy(registrations.year);

    const yearStats: Record<string, number> = {};
    for (const row of yearResult) {
      yearStats[row.year] = Number(row.count);
    }

    // 5. Day-wise registrations for last 10 days (success + pending)
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 9);

    const startISO = startDate.toISOString().slice(0, 10);
    const endISO = today.toISOString().slice(0, 10);

    const dailyStatsRaw = await db
    .select({
      day: sql<string>`DATE(${registrations.createdAt})`,
      paymentStatus: registrations.paymentStatus,
      count: count(registrations.id),
    })
    .from(registrations)
    .where(sql`DATE(${registrations.createdAt}) BETWEEN ${startISO} AND ${endISO}`)
    .groupBy(sql`DATE(${registrations.createdAt})`, registrations.paymentStatus)
    .orderBy(sql`DATE(${registrations.createdAt})`);

    const dailyStats: Record<string, { success: number; pending: number }> = {};

    for (let i = 0; i < 10; i++) {
      const day = new Date(startDate);
      day.setDate(startDate.getDate() + i);
      const dayStr = day.toISOString().slice(0, 10);
      dailyStats[dayStr] = { success: 0, pending: 0 };
    }

    for (const row of dailyStatsRaw) {
      const day = row.day;
      const status = row.paymentStatus;
      const count = Number(row.count);

      if (!dailyStats[day]) {
        dailyStats[day] = { success: 0, pending: 0 };
      }

      if (status === "success") {
        dailyStats[day].success += count;
      } else {
        dailyStats[day].pending += count;
      }
    }

    return NextResponse.json({
      success: true,
      total: totalSuccess,
      totalAll: totalRegistrations,
      pending,
      successPercent,
      pendingPercent,
      domains: domainStats,
      years: yearStats,
      daily: dailyStats,
    });
  } catch (error) {
    console.error('Stats API Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
