import { pgTable, serial, text, varchar, timestamp, index, jsonb, pgEnum, boolean, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const paymentStatusEnum = pgEnum('payment_status_enum', ['pending', 'success', 'failure']);

export const registrations = pgTable('pferegistration', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 256 }).notNull(),
  email: varchar('email', { length: 256 }).notNull(),
  contact: varchar('contact', { length: 20 }).notNull(),
  course: varchar('course', { length: 100 }).notNull(),
  department: varchar('department', { length: 100 }).notNull(),
  year: varchar('year', { length: 50 }).notNull(),
  domain: varchar('domain', { length: 100 }).notNull(),
  orderId: varchar('order_id', { length: 256 }).notNull().unique(),
  paymentStatus: paymentStatusEnum('payment_status').default('pending').notNull(),
  qrCodeUrl: text('qr_code_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  attendance: jsonb('attendance').$type<boolean[]>().default([false, false, false]).notNull(),
  referral: text('referral'),
},
(table) => ({
  emailIdx: index('email_idx').on(table.email),
}));

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
