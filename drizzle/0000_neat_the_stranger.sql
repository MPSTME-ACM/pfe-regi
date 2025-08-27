CREATE TABLE "registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"email" varchar(256) NOT NULL,
	"contact" varchar(20) NOT NULL,
	"course" varchar(100) NOT NULL,
	"department" varchar(100) NOT NULL,
	"year" varchar(50) NOT NULL,
	"domain" varchar(100) NOT NULL,
	"order_id" varchar(256) NOT NULL,
	"payment_status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_email_unique" UNIQUE("email"),
	CONSTRAINT "registrations_order_id_unique" UNIQUE("order_id")
);
