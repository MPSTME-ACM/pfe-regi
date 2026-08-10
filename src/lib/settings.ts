import { db } from '@/lib/db';
import { settings, DEFAULT_FIELD_LABELS, type Settings, type FieldLabels } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Accessors for the singleton `settings` row.
 *
 * Deliberately NOT cached. Two other places in this codebase cache in module
 * scope (the email throttle in lib/mail/mailUtil.ts, the domain counter in
 * api/domain-count) and both go wrong behind more than one container: the
 * instances disagree with each other. This is a primary-key lookup of one row.
 * Pay for it.
 */

const SETTINGS_ID = 1;

/**
 * Values used when the row cannot be read at all — a fresh database, a failed
 * migration, or the DB being down. Registration is CLOSED here on purpose: if
 * we cannot tell whether we are open, we are not open.
 */
export const FALLBACK_SETTINGS: Settings = {
  id: SETTINGS_ID,
  registrationOpen: false,
  closedTitle: 'Registration is currently closed',
  closedBody: 'Please check back soon.',
  priceCapstone: 10000,
  priceSingle: 25000,
  priceBundle: 50000,
  eventConfig: {
    dateRange: '17 - 23 September 2026',
    timeRange: '5:00 PM - 7:00 PM',
    venue: 'MPSTME Campus, Mumbai',
    contactEmail: 'pfe@mpst.me',
    whatsappUrl: 'https://wa.me/919076195651',
  },
  fieldOptions: {
    colleges: ['NMIMS MPSTME', 'Other'],
    courses: ['BTI', 'BTech', 'MBA Tech', 'Other'],
    departments: [
      'Computer Engineering', 'EXTC', 'Cybersecurity', 'AI', 'CSDS 311',
      'Data Science', 'Mechanical', 'IT', 'Civil', 'CSBS', 'Mechatronics', 'CSEDS', 'Other',
    ],
    years: [
      'First Year', 'Second Year', 'Third Year', 'Fourth Year', 'Fifth Year', 'Sixth Year',
    ],
  },
  fieldLabels: DEFAULT_FIELD_LABELS,
  updatedAt: new Date(0),
};

/**
 * Fill any missing field wording from the defaults.
 *
 * The stored value is a single jsonb blob, so a row written before a field was
 * added — or by an older deploy — is missing that key entirely. Without this the
 * form would render `undefined` as a label. Per-field rather than a shallow
 * spread, so a row that customises only `label` still inherits `placeholder`.
 */
export function withLabelDefaults(stored: Partial<FieldLabels> | null | undefined): FieldLabels {
  const out = {} as FieldLabels;
  for (const key of Object.keys(DEFAULT_FIELD_LABELS) as (keyof FieldLabels)[]) {
    out[key] = { ...DEFAULT_FIELD_LABELS[key], ...(stored?.[key] ?? {}) };
  }
  return out;
}

/**
 * Read the settings row. Never throws — callers on the render path should not
 * have to guard, and a DB blip must not take the marketing page down with it.
 */
export async function getSettings(): Promise<Settings> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);
    if (!rows[0]) return FALLBACK_SETTINGS;
    // Normalised here rather than at each call site so the form, the admin panel
    // and anything added later all see a complete object. A row written before
    // `field_labels` existed reads back as null, and an undefined label renders
    // as the literal string "undefined" next to a required field.
    return { ...rows[0], fieldLabels: withLabelDefaults(rows[0].fieldLabels) };
  } catch (error) {
    console.error('[settings] read failed, falling back to closed:', error);
    return FALLBACK_SETTINGS;
  }
}

/** Fields the admin panel is allowed to write. `id` and `updatedAt` are not. */
export type SettingsPatch = Partial<Omit<Settings, 'id' | 'updatedAt'>>;

/**
 * Apply a partial update. Unlike getSettings this DOES throw — a failed save
 * must surface to the admin rather than silently appearing to succeed.
 */
export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const [row] = await db
    .update(settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(settings.id, SETTINGS_ID))
    .returning();

  if (!row) {
    throw new Error('settings row is missing — has migration 0006 been applied?');
  }
  return row;
}

/** Paise -> the decimal-rupee string Cashfree's order_amount expects. */
export function paiseToRupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

/** Paise -> a display string, e.g. 25000 -> "₹250". */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
}
