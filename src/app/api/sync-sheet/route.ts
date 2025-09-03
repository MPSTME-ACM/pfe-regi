// app/api/sync-sheet/route.ts

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';

const sheets = google.sheets('v4');

const sheetAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
  key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return NextResponse.json({ success: false, message: 'Authorization header missing' }, { status: 401 });
  }

  try {
    const encoded = authHeader.split(' ')[1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [username, password] = decoded.split(':');

    if (username !== 'admin' || password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ success: false, message: 'Malformed authorization header' }, { status: 400 });
  }

  try {
    const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID;
    if (!sheetId) {
      throw new Error('Missing GOOGLE_SHEETS_SHEET_ID env variable');
    }

    await sheets.spreadsheets.get({ auth: sheetAuth, spreadsheetId: sheetId });

    const allRegistrations = await db.select().from(registrations);

    if (!allRegistrations.length) {
      return NextResponse.json({
        success: true,
        message: 'No registrations found to sync',
      });
    }

    const headers = [
      'Timestamp', 'Name', 'Email', 'Contact', 'Course',
      'Department', 'Year', 'Domain', 'Referral', 'Order ID', 'Payment Status',
    ];

    const sheetData = allRegistrations.map((reg) => [
      reg.createdAt?.toISOString() || '',
      reg.name || '',
      reg.email || '',
      reg.contact || '',
      reg.course || '',
      reg.department || '',
      reg.year || '',
      reg.domain || '',
      reg.referral || '',
      reg.orderId || '',
      reg.paymentStatus || '',
    ]);

    await sheets.spreadsheets.values.clear({
      auth: sheetAuth,
      spreadsheetId: sheetId,
      range: 'Sheet1',
    });

    await sheets.spreadsheets.values.update({
      auth: sheetAuth,
      spreadsheetId: sheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers, ...sheetData],
      },
    });

    return NextResponse.json({
      success: true,
      message: `Synced ${sheetData.length} registrations to Google Sheets.`,
    });
  } catch (error) {
    console.error('[SYNC ERROR]', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown sync error',
      },
      { status: 500 }
    );
  }
}
