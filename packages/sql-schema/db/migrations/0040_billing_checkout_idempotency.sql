CREATE TABLE "billing_checkout_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"purchaser_user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_checkout_url" text,
	"plan" text NOT NULL,
	"billing_period" text NOT NULL,
	"seat_quantity" integer NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_attempt_plan_check" CHECK ("billing_checkout_attempt"."plan" IN ('basic', 'business')),
	CONSTRAINT "billing_checkout_attempt_period_check" CHECK ("billing_checkout_attempt"."billing_period" IN ('monthly', 'yearly')),
	CONSTRAINT "billing_checkout_attempt_status_check" CHECK ("billing_checkout_attempt"."status" IN ('creating', 'open', 'completed', 'expired')),
	CONSTRAINT "billing_checkout_attempt_seat_check" CHECK ("billing_checkout_attempt"."seat_quantity" > 0),
	CONSTRAINT "billing_checkout_attempt_session_check" CHECK (("billing_checkout_attempt"."status" = 'creating' AND "billing_checkout_attempt"."stripe_checkout_session_id" IS NULL AND "billing_checkout_attempt"."stripe_checkout_url" IS NULL AND "billing_checkout_attempt"."expires_at" IS NULL) OR ("billing_checkout_attempt"."status" <> 'creating' AND "billing_checkout_attempt"."stripe_checkout_session_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "billing_customer" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "billing_customer" ("organization_id", "stripe_customer_id")
SELECT "organization_id", "stripe_customer_id"
FROM "billing_subscription"
ON CONFLICT ("organization_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "billing_checkout_attempt" ADD CONSTRAINT "billing_checkout_attempt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkout_attempt" ADD CONSTRAINT "billing_checkout_attempt_purchaser_user_id_user_id_fk" FOREIGN KEY ("purchaser_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_attempt_organization_unique" ON "billing_checkout_attempt" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_attempt_session_unique" ON "billing_checkout_attempt" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_stripe_customer_unique" ON "billing_customer" USING btree ("stripe_customer_id");
