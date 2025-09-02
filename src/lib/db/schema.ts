import { pgTable, serial, text, varchar, timestamp, index, jsonb, pgEnum } from 'drizzle-orm/pg-core';

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
