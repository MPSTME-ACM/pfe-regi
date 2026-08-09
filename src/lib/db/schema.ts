import { pgTable, serial, text, varchar, timestamp, index, jsonb, pgEnum, boolean, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// PFE 2026.
//
// 2025 ran as one 3-day workshop: every registration picked a single `domain`
// and attendance was a 3-slot boolean array. 2026 is three segments, seven
// tracks, five event days and three price tiers, so the old shape cannot
// express it. The 2025 rows live on in `registrations2025`, read-only.
// ─────────────────────────────────────────────────────────────────────────────

/** `comped` is new: a free registration granted by ACM, as distinct from a real
 *  payment failure. Previously comps were written as 'failure' so they would
 *  dodge the capacity check, which quietly corrupted the /stats percentages. */
export const paymentStatusEnum = pgEnum('payment_status_enum', [
  'pending', 'success', 'failure', 'comped',
]);

export const segmentEnum = pgEnum('segment_enum', ['beginner', 'advanced', 'capstone']);

/** The three purchasable products. There is deliberately no
 *  beginner+advanced-without-capstone option: at ₹500 the bundle dominates it. */
export const skuEnum = pgEnum('sku_enum', ['capstone', 'single', 'bundle']);

// ─── tracks ──────────────────────────────────────────────────────────────────
// A table, not a jsonb blob on `settings`, for one reason: capacity has to be
// checked and decremented under `SELECT ... FOR UPDATE` inside the same
// transaction as the registration insert. You cannot row-lock a JSON key.

export const tracks = pgTable('tracks', {
  id: serial('id').primaryKey(),
  /** Stable machine key. Never renamed — `name` is the display label. */
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  segment: segmentEnum('segment').notNull(),
  /** ISO dates this track runs, e.g. ['2026-09-17','2026-09-18']. Drives both
   *  the attendance checkboxes at the door and the confirmation email. */
  dates: jsonb('dates').$type<string[]>().notNull().default([]),
  capacity: integer('capacity').notNull().default(120),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => ({
  segmentIdx: index('tracks_segment_idx').on(table.segment),
}));

export type Track = typeof tracks.$inferSelect;

// ─── registrations ───────────────────────────────────────────────────────────

export const registrations = pgTable('pferegistration', {
  id: serial('id').primaryKey(),

  name: varchar('name', { length: 256 }).notNull(),
  email: varchar('email', { length: 256 }).notNull(),
  contact: varchar('contact', { length: 20 }).notNull(),
  /** New for 2026 — the program is open to students from other colleges. */
  college: varchar('college', { length: 200 }).notNull().default(''),
  course: varchar('course', { length: 100 }).notNull(),
  department: varchar('department', { length: 100 }).notNull(),
  year: varchar('year', { length: 50 }).notNull(),

  // -- what they bought -------------------------------------------------------
  sku: skuEnum('sku').notNull(),
  /** Null unless the SKU includes a beginner track. */
  beginnerTrackId: integer('beginner_track_id').references(() => tracks.id),
  /** Null unless the SKU includes an advanced track. */
  advancedTrackId: integer('advanced_track_id').references(() => tracks.id),
  hasCapstone: boolean('has_capstone').notNull().default(false),
  /** Integer PAISE. Computed server-side; the client never sends an amount. */
  amountPaid: integer('amount_paid').notNull().default(0),

  // -- phase 3 (coupons + referral attribution) -------------------------------
  couponId: integer('coupon_id'),
  referrerId: integer('referrer_id'),
  referral: text('referral'),

  // -- payment ----------------------------------------------------------------
  /** OPAQUE. 2025 encoded the domain in the last character and api/webhook
   *  parsed it back out, which broke the moment member order IDs gained an
   *  `-ACM` suffix. Never parse meaning out of this again — read the row. */
  orderId: varchar('order_id', { length: 256 }).notNull().unique(),
  paymentStatus: paymentStatusEnum('payment_status').default('pending').notNull(),
  qrCodeUrl: text('qr_code_url'),
  /** Null after a successful payment means the ticket email never went out.
   *  That is a paid-with-no-ticket customer; the admin panel surfaces these. */
  emailSentAt: timestamp('email_sent_at'),

  // -- attendance -------------------------------------------------------------
  /** Keyed BY DATE, e.g. { "2026-09-17": true }. Positional arrays were fine
   *  when everyone attended the same 3 days; now a capstone buyer attends 1 day
   *  and a bundle buyer attends 5, so position means nothing. */
  attendance: jsonb('attendance').$type<Record<string, boolean>>().notNull().default({}),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  emailIdx: index('email_idx').on(table.email),
  statusIdx: index('registration_status_idx').on(table.paymentStatus),
  beginnerTrackIdx: index('registration_beginner_track_idx').on(table.beginnerTrackId),
  advancedTrackIdx: index('registration_advanced_track_idx').on(table.advancedTrackId),
}));

export type Registration = typeof registrations.$inferSelect;

// ─── the 2025 archive ────────────────────────────────────────────────────────
// Declared so 2025 tickets still resolve at /verify and /payment-status. Never
// written to. Mirrors the pre-2026 column set exactly.

export const registrations2025 = pgTable('pferegistration_2025', {
  id: integer('id').primaryKey(),
  name: varchar('name', { length: 256 }).notNull(),
  email: varchar('email', { length: 256 }).notNull(),
  contact: varchar('contact', { length: 20 }).notNull(),
  course: varchar('course', { length: 100 }),
  department: varchar('department', { length: 100 }),
  year: varchar('year', { length: 50 }),
  domain: varchar('domain', { length: 100 }),
  orderId: varchar('order_id', { length: 256 }).notNull(),
  paymentStatus: varchar('payment_status', { length: 20 }),
  qrCodeUrl: text('qr_code_url'),
  createdAt: timestamp('created_at'),
  attendance: jsonb('attendance').$type<boolean[]>(),
  referral: text('referral'),
});

export type Registration2025 = typeof registrations2025.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// settings — a single row (id = 1) holding everything the admin panel can change
// without a deploy. Before this existed, opening and closing registration meant
// renaming five files and committing; see CLAUDE.md.
//
// Prices are stored in PAISE (integer). Never store money as a float. Cashfree
// wants decimal rupees, so convert only at that boundary: paise / 100.
// ─────────────────────────────────────────────────────────────────────────────

/** Free-text copy and dates shown on the form and in the confirmation email. */
export type EventConfig = {
  /** Human-readable date range, e.g. "17 - 23 September 2026". */
  dateRange: string;
  /** e.g. "5:00 PM - 7:00 PM". */
  timeRange: string;
  venue: string;
  contactEmail: string;
  whatsappUrl: string;
};

/** Dropdown contents for the registration form. */
export type FieldOptions = {
  colleges: string[];
  courses: string[];
  departments: string[];
  years: string[];
};

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),

  // -- registration gate ------------------------------------------------------
  registrationOpen: boolean('registration_open').notNull().default(false),
  closedTitle: text('closed_title').notNull().default('Form Closed'),
  closedBody: text('closed_body').notNull().default('Thank you for your interest!'),

  // -- pricing, in paise ------------------------------------------------------
  priceCapstone: integer('price_capstone').notNull().default(10000),  // ₹100
  priceSingle: integer('price_single').notNull().default(25000),      // ₹250
  priceBundle: integer('price_bundle').notNull().default(50000),      // ₹500

  // -- list-shaped config -----------------------------------------------------
  eventConfig: jsonb('event_config').$type<EventConfig>().notNull().default({
    dateRange: '17 - 23 September 2026',
    timeRange: '5:00 PM - 7:00 PM',
    venue: 'MPSTME Campus, Mumbai',
    contactEmail: 'pfe@mpst.me',
    whatsappUrl: 'https://wa.me/919076195651',
  }),
  fieldOptions: jsonb('field_options').$type<FieldOptions>().notNull().default({
    colleges: ['NMIMS MPSTME', 'Other'],
    courses: ['BTI', 'BTech', 'MBA Tech', 'Other'],
    departments: [
      'Computer Engineering', 'EXTC', 'Cybersecurity', 'AI', 'CSDS 311',
      'Data Science', 'Mechanical', 'IT', 'Civil', 'CSBS', 'Mechatronics', 'CSEDS', 'Other',
    ],
    years: ['First Year', 'Second Year', 'Third Year', 'Fourth Year', 'Fifth Year'],
  }),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
},
(table) => ({
  // Belt and braces: the table is a singleton. Without this, a stray INSERT
  // creates a second row and every read silently picks an arbitrary one.
  singleton: check('settings_singleton', sql`${table.id} = 1`),
}));

export type Settings = typeof settings.$inferSelect;
