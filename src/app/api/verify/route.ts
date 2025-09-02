import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
    try {
        // 1. Basic Authentication
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return NextResponse.json({ success: false, message: 'Authorization required' }, { status: 401 });
        }

        const encodedCreds = authHeader.split(' ')[1];
        const decodedCreds = Buffer.from(encodedCreds, 'base64').toString('utf-8');
        const [username, password] = decodedCreds.split(':');
        
        // Simple check: username is 'admin', password is from env
        if (username !== 'admin' || password !== process.env.ADMIN_PASSWORD) {
            return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
        }
        
        // 2. Get data from the request body
        const { orderId, attendance } = await request.json();

        if (!orderId) {
            return NextResponse.json({ success: false, message: 'Order ID is required' }, { status: 400 });
        }

        // Find the registration record
        const results = await db.select().from(registrations).where(eq(registrations.orderId, orderId));
        if (results.length === 0) {
            return NextResponse.json({ success: false, message: 'Ticket not found or invalid' }, { status: 404 });
        }
        const registration = results[0];

        // 3. Handle Update or Fetch
        if (attendance && Array.isArray(attendance)) {
            // If attendance data is provided, update it
            await db.update(registrations)
                .set({ attendance })
                .where(eq(registrations.orderId, orderId));
            
            const updatedResult = await db.select().from(registrations).where(eq(registrations.orderId, orderId));
            
            return NextResponse.json({ success: true, message: 'Attendance updated', details: updatedResult[0] });

        } else {
            // If no attendance data, just fetch and return the details
            return NextResponse.json({ success: true, details: registration });
        }

    } catch (error) {
        console.error('Verification API Error:', error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}
