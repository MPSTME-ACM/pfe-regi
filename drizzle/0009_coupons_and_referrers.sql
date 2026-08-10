CREATE TYPE "public"."coupon_type_enum" AS ENUM('percent', 'flat', 'fixed', 'free');--> statement-breakpoint
CREATE TYPE "public"."redemption_state_enum" AS ENUM('reserved', 'burned', 'released');--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"coupon_id" integer NOT NULL,
	"order_id" varchar(256) NOT NULL,
	"email" varchar(256) NOT NULL,
	"contact" varchar(20) NOT NULL,
	"amount_off" integer DEFAULT 0 NOT NULL,
	"state" "redemption_state_enum" DEFAULT 'reserved' NOT NULL,
	"reserved_until" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"type" "coupon_type_enum" NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"applies_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_amount" integer,
	"max_uses" integer,
	"max_per_person" integer,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"batch_id" varchar(64),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referrers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referrers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemption_order_unique" ON "coupon_redemptions" USING btree ("coupon_id","order_id");--> statement-breakpoint
CREATE INDEX "coupon_redemption_state_idx" ON "coupon_redemptions" USING btree ("coupon_id","state");--> statement-breakpoint
CREATE INDEX "coupons_batch_idx" ON "coupons" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "pferegistration" ADD CONSTRAINT "pferegistration_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pferegistration" ADD CONSTRAINT "pferegistration_referrer_id_referrers_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."referrers"("id") ON DELETE no action ON UPDATE no action;