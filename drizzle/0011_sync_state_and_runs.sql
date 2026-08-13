CREATE TYPE "public"."sync_source_enum" AS ENUM('schedule', 'http');--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "sync_source_enum" NOT NULL,
	"trigger_note" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"ok" boolean DEFAULT false NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"appended" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"running" boolean DEFAULT false NOT NULL,
	"started_at" timestamp,
	"source" "sync_source_enum",
	CONSTRAINT "sync_state_singleton" CHECK ("sync_state"."id" = 1)
);
--> statement-breakpoint
CREATE INDEX "sync_run_started_idx" ON "sync_runs" USING btree ("started_at");--> statement-breakpoint
-- The lease is claimed with an UPDATE, and an UPDATE against an empty table
-- claims nothing — every sync would silently report "already running" forever.
-- Seeded here for the same reason 0006 seeds `settings`: the singleton has to
-- exist before anything can read or write it.
INSERT INTO "sync_state" ("id", "running") VALUES (1, false) ON CONFLICT ("id") DO NOTHING;