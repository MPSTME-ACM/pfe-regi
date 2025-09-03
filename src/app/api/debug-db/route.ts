import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';

export async function GET() {
  console.log("[DEBUG] Testing database connection...");
  
  try {
    // Test basic database connection
    console.log("[DEBUG] Attempting to fetch registrations...");
    const startTime = Date.now();
    
    const allRegistrations = await db.select().from(registrations).limit(5);
    
    const endTime = Date.now();
    console.log(`[DEBUG] Query completed in ${endTime - startTime}ms`);
    console.log(`[DEBUG] Fetched ${allRegistrations.length} records (limited to 5)`);
    
    // Log first record structure (without sensitive data)
    if (allRegistrations.length > 0) {
      const sample = allRegistrations[0];
      console.log("[DEBUG] Sample record structure:", {
        id: sample.id,
        hasName: !!sample.name,
        hasEmail: !!sample.email,
        hasContact: !!sample.contact,
        course: sample.course,
        department: sample.department,
        year: sample.year,
        domain: sample.domain,
        paymentStatus: sample.paymentStatus,
        createdAt: sample.createdAt,
        hasOrderId: !!sample.orderId,
      });
    }
    
    return NextResponse.json({
      success: true,
      count: allRegistrations.length,
      queryTime: `${endTime - startTime}ms`,
      sampleStructure: allRegistrations.length > 0 ? Object.keys(allRegistrations[0]) : []
    });
    
  } catch (error) {
    console.error("[DEBUG ERROR]:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}