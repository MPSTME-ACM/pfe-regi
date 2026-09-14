ALTER TABLE "settings" ADD COLUMN "price_single_capstone" integer DEFAULT 35000 NOT NULL;--> statement-breakpoint
-- The DEFAULT above backfills the singleton, but ₹350 is only the right answer for
-- a row still on the default single and capstone prices. Seed from the live ones.
UPDATE "settings" SET "price_single_capstone" = "price_single" + "price_capstone";