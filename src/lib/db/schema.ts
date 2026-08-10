import { pgTable, serial, text, varchar, timestamp, index, uniqueIndex, jsonb, pgEnum, boolean, integer, check } from 'drizzle-orm/pg-core';
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
  /** The coupon applied, if any. The FK is deliberate: it makes deleting a
   *  redeemed coupon impossible, which is correct — disable it instead, or the
   *  discount on a paid order becomes unexplainable after the fact. */
  couponId: integer('coupon_id').references(() => coupons.id),
  /** Attribution only. A referrer never changes the price. */
  referrerId: integer('referrer_id').references(() => referrers.id),
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

// ─── coupons ─────────────────────────────────────────────────────────────────
// Column-for-column the `Coupon` interface in lib/pricing/resolvePrice.ts, so a
// row can be handed to resolvePrice() with no mapping layer to drift out of sync.
//
// ACM's 50%-off member codes are not a separate mechanism: they are rows here
// with type='percent', value=50, maxUses=1. One engine, one redemption log.

export const couponTypeEnum = pgEnum('coupon_type_enum', ['percent', 'flat', 'fixed', 'free']);

export const coupons = pgTable('coupons', {
  id: serial('id').primaryKey(),
  /** Always stored UPPERCASE and trimmed — see normaliseCode(). */
  code: varchar('code', { length: 40 }).notNull().unique(),
  type: couponTypeEnum('type').notNull(),
  /** percent: 0..100 · flat: paise off · fixed: resulting paise · free: ignored. */
  value: integer('value').notNull().default(0),
  /** Which SKUs it applies to. Empty array means all of them. */
  appliesTo: jsonb('applies_to').$type<string[]>().notNull().default([]),
  /** Minimum order value in paise, before discount. */
  minAmount: integer('min_amount'),
  /** Total redemptions across everyone. Null = unlimited. */
  maxUses: integer('max_uses'),
  /** Redemptions per person, keyed on email+contact. Null = unlimited. */
  maxPerPerson: integer('max_per_person'),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  enabled: boolean('enabled').notNull().default(true),
  /** Groups one bulk generation so the panel can list and export it as a batch. */
  batchId: varchar('batch_id', { length: 64 }),
  /** Free text for the committee: what this code is for, who it went to. */
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  batchIdx: index('coupons_batch_idx').on(table.batchId),
}));

export type CouponRow = typeof coupons.$inferSelect;

export const redemptionStateEnum = pgEnum('redemption_state_enum', [
  'reserved', 'burned', 'released',
]);

/**
 * One row per (coupon, order) attempt.
 *
 * The lifecycle is reserve → burn on payment, or release on failure. A user who
 * closes the Cashfree modal produces NO webhook at all, so `reservedUntil` is
 * what stops a single-use code being locked forever by an abandoned checkout.
 */
export const couponRedemptions = pgTable('coupon_redemptions', {
  id: serial('id').primaryKey(),
  couponId: integer('coupon_id').notNull().references(() => coupons.id),
  /** The registration's orderId. Not an FK: the row is written in the same
   *  transaction as the registration, so the target may not be visible yet. */
  orderId: varchar('order_id', { length: 256 }).notNull(),
  email: varchar('email', { length: 256 }).notNull(),
  contact: varchar('contact', { length: 20 }).notNull(),
  /** Paise actually discounted, recorded at reserve time for reporting. */
  amountOff: integer('amount_off').notNull().default(0),
  state: redemptionStateEnum('state').notNull().default('reserved'),
  /** After this, a `reserved` row no longer holds the seat. */
  reservedUntil: timestamp('reserved_until', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // The webhook is idempotent by design and Cashfree retries; without this a
  // retry could burn the same coupon twice for one order.
  onePerOrder: uniqueIndex('coupon_redemption_order_unique').on(table.couponId, table.orderId),
  stateIdx: index('coupon_redemption_state_idx').on(table.couponId, table.state),
}));

export type CouponRedemption = typeof couponRedemptions.$inferSelect;

// ─── referrers ───────────────────────────────────────────────────────────────
// Attribution only, by decision: a referrer code credits a committee member on
// the leaderboard and carries NO discount. Discounts are coupons.

export const referrers = pgTable('referrers', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Referrer = typeof referrers.$inferSelect;

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

/**
 * The visible wording of one form field.
 *
 * `placeholder` is the grey hint: the HTML placeholder on a text input, and the
 * unselected prompt on a `<select>`.
 *
 * `selectPrompt` exists for exactly two fields. `course` and `department` render
 * as dropdowns for a known college and as free text once "Other" is picked, so
 * they are the only fields that need two different hints — "B.Tech" reads well
 * in an empty text box and badly as a dropdown's unselected state. Every other
 * field is one control or the other, so `placeholder` alone covers it.
 */
export type FieldText = {
  label: string;
  placeholder: string;
  /** Only meaningful for `course` and `department`. Ignored elsewhere. */
  selectPrompt?: string;
};

/**
 * The wording of the registration form, editable at /admin.
 *
 * Keys are the DATA names — `course` and `department` are the column names on
 * `pferegistration` — and are fixed. Only the wording moves. That separation is
 * the point: the 2026 form labels `course` as "Programme" and `department` as
 * "Course", and doing that as data means no migration, no deploy, and no risk
 * of a rename drifting away from the column it describes.
 */
export type FieldLabels = {
  name: FieldText;
  email: FieldText;
  contact: FieldText;
  college: FieldText;
  course: FieldText;
  department: FieldText;
  year: FieldText;
  referral: FieldText;
};

/** The shipped wording. Also the shape every admin edit is merged onto. */
export const DEFAULT_FIELD_LABELS: FieldLabels = {
  // Worked examples rather than instructions ("Enter your full name"). A filled-in
  // shape is faster to pattern-match than a sentence telling you to fill it in.
  name: { label: 'Your Name', placeholder: 'Parth Gupta' },
  email: { label: 'Your Email', placeholder: 'mail@parthg.me' },
  contact: { label: 'Contact Number', placeholder: '9406084060' },
  college: { label: 'College', placeholder: 'Select your option' },
  course: { label: 'Course', placeholder: 'B.Tech', selectPrompt: 'Select your option' },
  department: { label: 'Department', placeholder: 'Computer Science', selectPrompt: 'Select your option' },
  year: { label: 'Current Academic Year', placeholder: 'Select your option' },
  referral: { label: 'Referral', placeholder: 'Optional' },
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
    years: [
      'First Year', 'Second Year', 'Third Year', 'Fourth Year', 'Fifth Year', 'Sixth Year',
    ],
  }),
  fieldLabels: jsonb('field_labels').$type<FieldLabels>().notNull().default(DEFAULT_FIELD_LABELS),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
},
(table) => ({
  // Belt and braces: the table is a singleton. Without this, a stray INSERT
  // creates a second row and every read silently picks an arbitrary one.
  singleton: check('settings_singleton', sql`${table.id} = 1`),
}));

export type Settings = typeof settings.$inferSelect;
