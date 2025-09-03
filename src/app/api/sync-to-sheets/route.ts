import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';

const sheets = google.sheets('v4');

const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

export async function POST() {
  console.log("\n[SYNC LOG] --- Sync to Google Sheets API route initiated ---");

  try {
    // 1. Verify Environment Variables
    console.log("[SYNC LOG] Verifying environment variables...");
    const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID;
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKeyLoaded = process.env.GOOGLE_SHEETS_PRIVATE_KEY ? 'Loaded' : 'MISSING!';
    
    console.log(`[SYNC LOG]   -> Spreadsheet ID: ${sheetId}`);
    console.log(`[SYNC LOG]   -> Client Email: ${clientEmail}`);
    console.log(`[SYNC LOG]   -> Private Key: ${privateKeyLoaded}`);

    if (!sheetId || !clientEmail || privateKeyLoaded === 'MISSING!') {
        throw new Error("One or more required Google Sheets environment variables are missing.");
    }

    // 2. Test authentication and spreadsheet access
    console.log("[SYNC LOG] Testing authentication and spreadsheet access...");
    try {
      const testResponse = await sheets.spreadsheets.get({
        auth,
        spreadsheetId: sheetId,
      });
      console.log(`[SYNC LOG]   -> Success! Connected to spreadsheet: "${testResponse.data.properties?.title}"`);
    } catch (authError) {
      // console.error("[SYNC ERROR] Authentication or spreadsheet access failed:", authError.response?.data || authError.message);
      // if (authError.code === 404) {
      //   throw new Error(`Spreadsheet not found. Please check the GOOGLE_SHEETS_SHEET_ID and ensure it's correct.`);
      // } else if (authError.code === 403) {
      //   throw new Error(`Access denied. Please share your Google Sheet with the service account email: ${clientEmail}`);
      // }
      throw authError; // Rethrow for other unexpected errors
    }

    // 3. Fetch all registrations from the database
    console.log("[SYNC LOG] Fetching all registrations from the database...");
    let allRegistrations;
    
    try {
      const startTime = Date.now();
      // Directly fetch all records. This also serves as a connection test.
      allRegistrations = await db.select().from(registrations);
      const endTime = Date.now();
      
      console.log(`[SYNC LOG] Database query completed in ${endTime - startTime}ms`);
      console.log(`[SYNC LOG] Successfully fetched ${allRegistrations.length} records from the database.`);
      
    } catch (dbError) {
      console.error("[SYNC ERROR] Failed to fetch registrations from database:", dbError);
      // Throw a new, more specific error to be caught by the outer handler
      // throw new Error(`Database query failed: ${dbError.message}`);
    }

    if (!allRegistrations || allRegistrations.length === 0) {
      console.log("[SYNC LOG] No new registrations found in the database to sync.");
      return NextResponse.json({ 
        success: true, 
        message: "No registrations found to sync" 
      });
    }

    // 4. Prepare data for Google Sheets
    console.log("[SYNC LOG] Preparing data for Google Sheets...");
    const headers = [
      'Timestamp', 'Name', 'Email', 'Contact', 'Course', 
      'Department', 'Year', 'Domain', 'Referral', 'Order ID', 'Payment Status'
    ];
    
    const sheetData = allRegistrations.map(reg => [
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

    // Combine headers and data
    const valuesToWrite = [headers, ...sheetData];

    // 5. Clear existing data and push new data in one operation
    const range = 'Sheet1!A1'; // Start from the very first cell
    console.log(`[SYNC LOG] Clearing sheet and pushing ${sheetData.length} new records...`);

    // First, clear the entire sheet to avoid leftover data
    await sheets.spreadsheets.values.clear({
        auth,
        spreadsheetId: sheetId,
        range: 'Sheet1', // Clear the whole sheet
    });
    
    // Then, update the sheet with the new values
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId: sheetId,
      range: range,
      valueInputOption: 'RAW',
      requestBody: {
        values: valuesToWrite,
      },
    });
    
    console.log("[SYNC LOG] --- Sync process completed successfully! ---");
    
    return NextResponse.json({ 
      success: true, 
      message: `Successfully synced ${sheetData.length} registrations to Google Sheets` 
    });

  } catch (error) {
    console.error("\n[SYNC ERROR] An unexpected error occurred during the sync process:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'An unknown error occurred' 
    }, { status: 500 });
  }
}