import { pgTable, serial, text, varchar, timestamp } from 'drizzle-orm/pg-core';

export const registrations = pgTable('registrations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 256 }).notNull(),
  email: varchar('email', { length: 256 }).notNull().unique(),
  contact: varchar('contact', { length: 20 }).notNull(),
  course: varchar('course', { length: 100 }).notNull(),
  department: varchar('department', { length: 100 }).notNull(),
  year: varchar('year', { length: 50 }).notNull(),
  domain: varchar('domain', { length: 100 }).notNull(),
  orderId: varchar('order_id', { length: 256 }).notNull().unique(),
  paymentStatus: text('payment_status', { enum: ['pending', 'success', 'failure'] }).default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});