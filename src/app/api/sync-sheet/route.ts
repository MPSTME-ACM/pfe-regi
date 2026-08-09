import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { db } from '@/lib/db';
import { registrations, tracks } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  SHEET_TAB_2026,
  a1,
  canonicalHeaderRow,
  planSheetSync,
  toCanonicalRow,
  type SheetRegistration,
  type SheetRow,
} from '@/lib/registration/sheetSync';

/**
 * Sync the live 2026 registrations into their own tab.
 *
 * The 2025 rows live in the tab named `Sheet1` and are no longer in the live
 * table at all (they were archived to `pferegistration_2025`), so diffing them
 * against the DB would treat every one of them as a stray. `Sheet1` is left
 * exactly as it is; 2026 writes to SHEET_TAB_2026 and nowhere else.
 *
 * The diff itself is in lib/registration/sheetSync.ts and is a pure function.
 * This file is only the plumbing: read, plan, apply.
 */

const sheets = google.sheets('v4');

const sheetAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
  key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function tabExists(spreadsheetId: string): Promise<boolean> {
  const meta = await sheets.spreadsheets.get({
    auth: sheetAuth,
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  return (meta.data.sheets ?? []).some((s) => s.properties?.title === SHEET_TAB_2026);
}

/**
 * Create the 2026 tab if it is not there yet.
 *
 * The external cron and the manual button on /sync can fire at the same time,
 * and a second `addSheet` for a title that now exists is a 400. Re-check on
 * failure rather than surfacing that as an opaque 500.
 */
async function ensureTab(spreadsheetId: string): Promise<boolean> {
  if (await tabExists(spreadsheetId)) return false;
  try {
    await sheets.spreadsheets.batchUpdate({
      auth: sheetAuth,
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_TAB_2026 } } }],
      },
    });
    return true;
  } catch (error) {
    if (await tabExists(spreadsheetId)) return false;
    throw error;
  }
}

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

    // --- Step A: Fetch both sources. The tab has to exist before it can be read.
    const [createdTab, dbRegistrations, trackRows] = await Promise.all([
      ensureTab(sheetId),
      db.select().from(registrations).orderBy(asc(registrations.createdAt)),
      // Every track, not `trackAvailability()`: that filters on `enabled`, and a
      // registration can point at a track that has since been switched off.
      db.select({ id: tracks.id, name: tracks.name }).from(tracks),
    ]);

    const trackName = new Map(trackRows.map((t) => [t.id, t.name]));

    const rows: SheetRegistration[] = dbRegistrations.map((reg) => ({
      createdAt: reg.createdAt,
      name: reg.name,
      email: reg.email,
      contact: reg.contact,
      college: reg.college,
      course: reg.course,
      department: reg.department,
      year: reg.year,
      sku: reg.sku,
      beginnerTrackName: reg.beginnerTrackId ? trackName.get(reg.beginnerTrackId) ?? '' : null,
      advancedTrackName: reg.advancedTrackId ? trackName.get(reg.advancedTrackId) ?? '' : null,
      hasCapstone: reg.hasCapstone,
      amountPaid: reg.amountPaid,
      paymentStatus: reg.paymentStatus,
      orderId: reg.orderId,
      referral: reg.referral,
    }));

    const sheetResponse = await sheets.spreadsheets.values.get({
      auth: sheetAuth,
      spreadsheetId: sheetId,
      range: a1(SHEET_TAB_2026),
    });
    const sheetValues = (sheetResponse.data.values || []) as SheetRow[];

    // --- Step B: Empty tab (freshly created, or emptied by hand) — stamp the
    // canonical header and everything under it. Note this is `=== 0`: a tab
    // holding only a header row must go down the normal diff path instead.
    if (sheetValues.length === 0) {
      const created = createdTab ? `Created the '${SHEET_TAB_2026}' tab. ` : '';
      if (rows.length === 0) {
        return NextResponse.json({
          success: true,
          message: `${created}No database records to sync to the empty '${SHEET_TAB_2026}' tab.`,
        });
      }
      await sheets.spreadsheets.values.update({
        auth: sheetAuth,
        spreadsheetId: sheetId,
        range: a1(SHEET_TAB_2026, 'A1'),
        valueInputOption: 'RAW',
        requestBody: { values: [canonicalHeaderRow(), ...rows.map(toCanonicalRow)] },
      });
      return NextResponse.json({
        success: true,
        message: `${created}Initial sync to '${SHEET_TAB_2026}' complete. Added ${rows.length} records.`,
      });
    }

    // --- Step C: Diff. Pure — no API calls happen in here.
    const plan = planSheetSync(sheetValues, rows);

    // --- Step D: Apply. Batch update the changed rows, then append the new ones.
    if (plan.updates.length > 0) {
      console.log(`[SYNC] Updating ${plan.updates.length} records...`);
      await sheets.spreadsheets.values.batchUpdate({
        auth: sheetAuth,
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: plan.updates.map((u) => ({
            range: a1(SHEET_TAB_2026, `A${u.rowIndex}`),
            values: [u.values],
          })),
        },
      });
    }

    if (plan.appends.length > 0) {
      console.log(`[SYNC] Appending ${plan.appends.length} new records...`);
      await sheets.spreadsheets.values.append({
        auth: sheetAuth,
        spreadsheetId: sheetId,
        range: a1(SHEET_TAB_2026, 'A1'),
        valueInputOption: 'RAW',
        requestBody: { values: plan.appends },
      });
    }

    const notes: string[] = [];
    if (createdTab) notes.push(`Created the '${SHEET_TAB_2026}' tab.`);
    if (plan.missingHeaders.length > 0) {
      // Not auto-added: inserting a column would shift every cell to its right.
      notes.push(`Skipped columns missing from the sheet: ${plan.missingHeaders.join(', ')}.`);
    }

    const message = [
      `Sync complete. Updated: ${plan.updates.length}. Appended: ${plan.appends.length}.`,
      ...notes,
    ].join(' ');
    return NextResponse.json({ success: true, message });

  } catch (error) {
    console.error('[SYNC ERROR]', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown sync error occurred';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
