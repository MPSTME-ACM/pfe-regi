/**
 * Google Sheets sync — the pure half.
 *
 * Everything here is deliberately dependency-free (no `@/*` imports, no I/O, no
 * googleapis types) so the diff can be reasoned about and executed on its own,
 * without credentials. `api/sync-sheet` maps a `Registration` row into
 * `SheetRegistration` and turns the plan into Sheets API calls; nothing in this
 * file knows the API exists.
 *
 * 2026 gets its own named tab and the sync writes to that tab and nothing else.
 * The 2025 rows are archived out of the live table, so a diff would treat every
 * one of them as a stray and try to delete or rewrite it — hence the hard
 * scoping rather than "whichever sheet is first".
 *
 * Historically that meant leaving a `Sheet1` alone in the same spreadsheet. The
 * spreadsheet now configured ("PFE Registrations 2026-27") has no `Sheet1` at
 * all — the 2025 record lives in a separate file — but the scoping still earns
 * its keep the moment anyone adds a tab of their own here.
 */

/** The only tab this sync ever writes to. */
export const SHEET_TAB_2026 = 'PFE2026';

/** The column the diff is keyed on. Looked up BY NAME, never by index. */
export const ORDER_ID_HEADER = 'Order ID';

/**
 * Canonical column order, used verbatim when the tab is empty.
 *
 * On an existing tab this is only a *set* of names: each field is written to
 * whatever column currently carries its header, so a human reordering columns
 * (or inserting a notes column of their own) does not shear the data.
 */
export const SHEET_HEADERS_2026 = [
  'Timestamp',
  'Name',
  'Email',
  'Contact',
  'College',
  'Course',
  'Department',
  'Year',
  'SKU',
  'Beginner Track',
  'Advanced Track',
  'Capstone',
  'Amount Paid (INR)',
  'Payment Status',
  ORDER_ID_HEADER,
  'Referral',
] as const;

export type SheetHeader = (typeof SHEET_HEADERS_2026)[number];

/** One row of cell values as the Sheets API hands them over / takes them back. */
export type SheetRow = string[];

/**
 * The shape the sync needs from a registration.
 *
 * Track *names* rather than ids: the caller resolves `beginnerTrackId` against
 * the `tracks` table, because a spreadsheet reader cannot do that join.
 */
export interface SheetRegistration {
  createdAt: Date | null;
  name: string;
  email: string;
  contact: string;
  college: string;
  course: string;
  department: string;
  year: string;
  sku: string;
  beginnerTrackName: string | null;
  advancedTrackName: string | null;
  hasCapstone: boolean;
  /** Integer paise, straight off the row. Converted to rupees for display only. */
  amountPaid: number;
  paymentStatus: string;
  orderId: string;
  referral: string | null;
}

/** A cell value that needs updating, and where it goes. */
export interface SheetUpdate {
  /** 1-based sheet row number, header included. */
  rowIndex: number;
  values: SheetRow;
}

export interface SheetPlan {
  updates: SheetUpdate[];
  appends: SheetRow[];
  /**
   * Canonical headers the sheet does not have a column for. Those fields are
   * skipped rather than guessed at — inventing a column would shift every cell
   * to its right. Surfaced so the sync result can say so out loud.
   */
  missingHeaders: SheetHeader[];
}

/**
 * Every cell is compared and written as a trimmed string.
 *
 * Sheets returns trailing empty cells as *absent*, not as `''`, so a row whose
 * last column (Referral) is blank comes back one cell short. Comparing whole
 * arrays with JSON.stringify would then mark every such row dirty on every run
 * and the sync would rewrite the entire sheet forever. Normalising both sides
 * per cell is what stops that.
 */
function cell(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

/**
 * Paise -> a plain rupee string for a human: 25000 -> "250", 33750 -> "337.5".
 *
 * Mirrors `paiseToRupees()` in lib/settings. This is a display conversion for a
 * spreadsheet cell, not the Cashfree boundary. No `toFixed(2)`: Sheets hands
 * "250" back, so writing "250.00" would make the row differ from itself and
 * churn on every sync.
 */
function paiseToRupeeCell(paise: number): string {
  if (!Number.isFinite(paise)) return '';
  return String(Number((paise / 100).toFixed(2)));
}

/** A registration as header -> cell value. */
export function toSheetCells(reg: SheetRegistration): Record<SheetHeader, string> {
  return {
    'Timestamp': reg.createdAt ? reg.createdAt.toISOString() : '',
    'Name': cell(reg.name),
    'Email': cell(reg.email),
    'Contact': cell(reg.contact),
    'College': cell(reg.college),
    'Course': cell(reg.course),
    'Department': cell(reg.department),
    'Year': cell(reg.year),
    'SKU': cell(reg.sku),
    'Beginner Track': cell(reg.beginnerTrackName),
    'Advanced Track': cell(reg.advancedTrackName),
    'Capstone': reg.hasCapstone ? 'Yes' : 'No',
    'Amount Paid (INR)': paiseToRupeeCell(reg.amountPaid),
    'Payment Status': cell(reg.paymentStatus),
    [ORDER_ID_HEADER]: cell(reg.orderId),
    'Referral': cell(reg.referral),
  };
}

/** A row in canonical column order — only correct for a sheet we just created. */
export function toCanonicalRow(reg: SheetRegistration): SheetRow {
  const cells = toSheetCells(reg);
  return SHEET_HEADERS_2026.map((h) => cells[h]);
}

/** The header row to stamp on a brand new tab. */
export function canonicalHeaderRow(): SheetRow {
  return [...SHEET_HEADERS_2026];
}

/** `'PFE2026'!A4` — quoted so a tab name with a space or a quote still parses. */
export function a1(tab: string, ref?: string): string {
  const quoted = `'${tab.replace(/'/g, "''")}'`;
  return ref ? `${quoted}!${ref}` : quoted;
}

/**
 * Widen a row to `width` without touching what is already in it.
 *
 * Deliberately does NOT normalise the existing cells: normalising happens at the
 * comparison site only. A column this sync does not own is copied back verbatim,
 * so a human's ' note ' keeps its spacing and, more importantly, a formula in
 * such a column is not flattened to the literal it currently renders as.
 */
function padTo(row: SheetRow, width: number): SheetRow {
  const out = row.slice(0, width);
  while (out.length < width) out.push('');
  return out;
}

/**
 * Diff the live registrations against what the tab already holds.
 *
 * Pure. Given the same sheet values and rows it always produces the same plan,
 * and it makes no assumption about column order beyond "there is a column whose
 * header is `Order ID`".
 *
 * Two properties worth stating, because both are corruption bugs when absent:
 *  - an update row is *seeded from the existing row* and only the cells this
 *    sync owns are overwritten, so a column a human added survives;
 *  - a row with no changed cell produces no update at all, so a clean sync is
 *    genuinely a no-op rather than a full rewrite.
 *
 * @throws if the sheet has no `Order ID` column — without it there is no key,
 *         and appending everything would duplicate the whole sheet.
 */
export function planSheetSync(sheetValues: SheetRow[], regs: SheetRegistration[]): SheetPlan {
  const headerRow = sheetValues[0] ?? [];

  const headerIndex = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = cell(h);
    // First occurrence wins: a duplicated header is a human mistake, and picking
    // the later one would silently move where the column is written.
    if (key && !headerIndex.has(key)) headerIndex.set(key, i);
  });

  const orderIdIdx = headerIndex.get(ORDER_ID_HEADER);
  if (orderIdIdx === undefined) {
    throw new Error(
      `A column named '${ORDER_ID_HEADER}' is required in the '${SHEET_TAB_2026}' tab and was not found.`,
    );
  }

  const owned: { header: SheetHeader; idx: number }[] = [];
  const missingHeaders: SheetHeader[] = [];
  for (const header of SHEET_HEADERS_2026) {
    const idx = headerIndex.get(header);
    if (idx === undefined) missingHeaders.push(header);
    else owned.push({ header, idx });
  }

  const minWidth = Math.max(
    headerRow.length,
    ...owned.map((o) => o.idx + 1),
  );

  // Existing rows keyed by order id. First occurrence wins — if a row got
  // duplicated by hand, the original is the one kept in step with the DB.
  const existing = new Map<string, { row: SheetRow; rowIndex: number }>();
  sheetValues.slice(1).forEach((row, i) => {
    const orderId = cell(row[orderIdIdx]);
    // +2: skip the header row, and sheet rows are 1-based.
    if (orderId && !existing.has(orderId)) existing.set(orderId, { row, rowIndex: i + 2 });
  });

  const updates: SheetUpdate[] = [];
  const appends: SheetRow[] = [];

  for (const reg of regs) {
    const cells = toSheetCells(reg);
    const orderId = cells[ORDER_ID_HEADER];
    if (!orderId) continue; // unkeyable; appending it would duplicate on the next run

    const match = existing.get(orderId);

    if (!match) {
      const row = new Array<string>(minWidth).fill('');
      for (const { header, idx } of owned) row[idx] = cells[header];
      appends.push(row);
      continue;
    }

    const width = Math.max(minWidth, match.row.length);
    const next = padTo(match.row, width);
    let changed = false;
    for (const { header, idx } of owned) {
      if (cell(next[idx]) !== cells[header]) {
        next[idx] = cells[header];
        changed = true;
      }
    }
    if (changed) updates.push({ rowIndex: match.rowIndex, values: next });
  }

  return { updates, appends, missingHeaders };
}
