import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/requireAdmin';

type SheetRow = string[];

const sheets = google.sheets('v4');

const sheetAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
  key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Helper function to format a database record into the correct sheet row format
const formatDbRecordAsRow = (reg: typeof registrations.$inferSelect) => [
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
];

export async function POST(request: Request) {
  // --- 1. Authentication & Authorization ---
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  // --- 2. Sync Logic ---
  try {
    const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID;
    if (!sheetId) {
      throw new Error('Missing GOOGLE_SHEETS_SHEET_ID env variable');
    }

    // console.log('[SYNC] Starting sync process...');

    // --- Step A: Fetch data from both sources ---
    const [sheetResponse, dbRegistrations] = await Promise.all([
      sheets.spreadsheets.values.get({ auth: sheetAuth, spreadsheetId: sheetId, range: 'Sheet1' }),
      db.select().from(registrations).orderBy(asc(registrations.createdAt)),
    ]);

    const sheetValues = (sheetResponse.data.values || []) as SheetRow[];

    // --- Step B: Handle initial sync for an empty sheet ---
    const headers = [
      'Timestamp', 'Name', 'Email', 'Contact', 'Course',
      'Department', 'Year', 'Domain', 'Referral', 'Order ID', 'Payment Status',
    ];
    
    if (sheetValues.length === 0) {
      console.log('[SYNC] Sheet is empty. Performing initial sync.');
      if (dbRegistrations.length > 0) {
        const initialData = dbRegistrations.map(formatDbRecordAsRow);
        await sheets.spreadsheets.values.update({
          auth: sheetAuth,
          spreadsheetId: sheetId,
          range: 'Sheet1!A1',
          valueInputOption: 'RAW',
          requestBody: { values: [headers, ...initialData] },
        });
        return NextResponse.json({ success: true, message: `Initial sync complete. Added ${initialData.length} records.` });
      }
      return NextResponse.json({ success: true, message: 'No database records to sync to the empty sheet.' });
    }

    // --- Step C: Map existing sheet data by Order ID for efficient lookup ---
    const sheetHeaders = sheetValues[0];
    const orderIdIndex = sheetHeaders.indexOf('Order ID');
    if (orderIdIndex === -1) {
      throw new Error("A column named 'Order ID' is required in the sheet and was not found.");
    }

    const sheetMap = new Map<string, { rowData: SheetRow; rowIndex: number }>();
    sheetValues.slice(1).forEach((row, index) => {
      const orderId = row[orderIdIndex];
      if (orderId) {
        // rowIndex is 1-based for sheets, and we add 1 for the header row
        sheetMap.set(orderId, { rowData: row, rowIndex: index + 2 });
      }
    });

    // --- Step D: Compare DB records to sheet map to find what to append or update ---
    const recordsToUpdate: { range: string; values: SheetRow[] }[] = [];
    const recordsToAppend: SheetRow[] = [];

    for (const dbRecord of dbRegistrations) {
      const dbRowArray = formatDbRecordAsRow(dbRecord);
      const existingSheetRecord = sheetMap.get(dbRecord.orderId);

      if (existingSheetRecord) {
        // Record exists: check if it needs an update.
        if (JSON.stringify(dbRowArray) !== JSON.stringify(existingSheetRecord.rowData)) {
          recordsToUpdate.push({
            range: `Sheet1!A${existingSheetRecord.rowIndex}`,
            values: [dbRowArray],
          });
        }
      } else {
        // Record is new: add it to the append list.
        recordsToAppend.push(dbRowArray);
      }
    }

    // --- Step E: Execute batch operations on the sheet ---
    if (recordsToUpdate.length > 0) {
      console.log(`[SYNC] Updating ${recordsToUpdate.length} records...`);
      await sheets.spreadsheets.values.batchUpdate({
        auth: sheetAuth,
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: recordsToUpdate,
        },
      });
    }

    if (recordsToAppend.length > 0) {
      console.log(`[SYNC] Appending ${recordsToAppend.length} new records...`);
      await sheets.spreadsheets.values.append({
        auth: sheetAuth,
        spreadsheetId: sheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: {
          values: recordsToAppend,
        },
      });
    }

    const message = `Sync complete. Updated: ${recordsToUpdate.length}. Appended: ${recordsToAppend.length}.`;
    // console.log(`[SYNC] ${message}`);
    return NextResponse.json({ success: true, message });

  } catch (error) {
    console.error('[SYNC ERROR]', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown sync error occurred';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
