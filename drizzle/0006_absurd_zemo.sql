CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"registration_open" boolean DEFAULT false NOT NULL,
	"closed_title" text DEFAULT 'Form Closed' NOT NULL,
	"closed_body" text DEFAULT 'Thank you for your interest!' NOT NULL,
	"price_capstone" integer DEFAULT 10000 NOT NULL,
	"price_single" integer DEFAULT 25000 NOT NULL,
	"price_bundle" integer DEFAULT 50000 NOT NULL,
	"event_config" jsonb DEFAULT '{"dateRange":"17 - 23 September 2026","timeRange":"5:00 PM - 7:00 PM","venue":"MPSTME Campus, Mumbai","contactEmail":"pfe@mpst.me","whatsappUrl":"https://wa.me/919076195651"}'::jsonb NOT NULL,
	"field_options" jsonb DEFAULT '{"colleges":["NMIMS MPSTME","Other"],"courses":["BTI","BTech","MBA Tech","Other"],"departments":["Computer Engineering","EXTC","Cybersecurity","AI","CSDS 311","Data Science","Mechanical","IT","Civil","CSBS","Mechatronics","CSEDS","Other"],"years":["First Year","Second Year","Third Year","Fourth Year","Fifth Year"]}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
-- Seed the singleton. Every column has a default, so this row is fully valid.
-- Registration defaults to CLOSED: a fresh deploy must not accidentally open it.
INSERT INTO "settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
