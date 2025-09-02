CREATE TYPE "public"."payment_status_enum" AS ENUM('pending', 'success', 'failure');--> statement-breakpoint
ALTER TABLE "pferegistration" ALTER COLUMN "payment_status" SET DEFAULT 'pending'::"public"."payment_status_enum";--> statement-breakpoint
ALTER TABLE "pferegistration" ALTER COLUMN "payment_status" SET DATA TYPE "public"."payment_status_enum" USING "payment_status"::"public"."payment_status_enum";--> statement-breakpoint
ALTER TABLE "pferegistration" ALTER COLUMN "payment_status" SET NOT NULL;