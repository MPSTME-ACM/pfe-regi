CREATE TYPE "public"."segment_enum" AS ENUM('beginner', 'advanced', 'capstone');--> statement-breakpoint
CREATE TYPE "public"."sku_enum" AS ENUM('capstone', 'single', 'bundle');--> statement-breakpoint
ALTER TYPE "public"."payment_status_enum" ADD VALUE 'comped';--> statement-breakpoint
CREATE TABLE "pferegistration_2025" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"email" varchar(256) NOT NULL,
	"contact" varchar(20) NOT NULL,
	"course" varchar(100),
	"department" varchar(100),
	"year" varchar(50),
	"domain" varchar(100),
	"order_id" varchar(256) NOT NULL,
	"payment_status" varchar(20),
	"qr_code_url" text,
	"created_at" timestamp,
	"attendance" jsonb,
	"referral" text
);
--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────
-- HAND-EDITED. Archive 2025 before reshaping, then clear the live table.
--
-- Two reasons this must happen here and not later:
--   1. `ADD COLUMN sku ... NOT NULL` below has no default, so it fails outright
--      if any row still exists.
--   2. The next migration drops `domain`, which is the only place a 2025
--      registration's track is recorded. Copy it first or lose it.
--
-- The whole migration runs in one transaction: if this copy fails, nothing is
-- dropped. `pferegistration_2025` is read-only afterwards — /verify and
-- /payment-status fall back to it so 2025 QR codes still resolve.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "pferegistration_2025" (
	"id", "name", "email", "contact", "course", "department", "year", "domain",
	"order_id", "payment_status", "qr_code_url", "created_at", "attendance", "referral"
)
SELECT
	"id", "name", "email", "contact", "course", "department", "year", "domain",
	"order_id", "payment_status"::text, "qr_code_url", "created_at", "attendance", "referral"
FROM "pferegistration";
--> statement-breakpoint
DELETE FROM "pferegistration";
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"segment" "segment_enum" NOT NULL,
	"dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capacity" integer DEFAULT 120 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tracks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "pferegistration" ALTER COLUMN "domain" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pferegistration" ALTER COLUMN "attendance" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "college" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "sku" "sku_enum" NOT NULL;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "beginner_track_id" integer;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "advanced_track_id" integer;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "has_capstone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "amount_paid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "coupon_id" integer;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "referrer_id" integer;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD COLUMN "email_sent_at" timestamp;--> statement-breakpoint
CREATE INDEX "tracks_segment_idx" ON "tracks" USING btree ("segment");--> statement-breakpoint
ALTER TABLE "pferegistration" ADD CONSTRAINT "pferegistration_beginner_track_id_tracks_id_fk" FOREIGN KEY ("beginner_track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD CONSTRAINT "pferegistration_advanced_track_id_tracks_id_fk" FOREIGN KEY ("advanced_track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_status_idx" ON "pferegistration" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "registration_beginner_track_idx" ON "pferegistration" USING btree ("beginner_track_id");--> statement-breakpoint
CREATE INDEX "registration_advanced_track_idx" ON "pferegistration" USING btree ("advanced_track_id");