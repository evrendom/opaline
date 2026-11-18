CREATE TABLE "billing_analytics_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" text NOT NULL,
	"event_name" text,
	"properties" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_analytics_outbox_kind_check" CHECK ("billing_analytics_outbox"."kind" IN ('event', 'traits')),
	CONSTRAINT "billing_analytics_outbox_event_check" CHECK (("billing_analytics_outbox"."kind" = 'event' AND "billing_analytics_outbox"."event_name" IS NOT NULL) OR ("billing_analytics_outbox"."kind" = 'traits' AND "billing_analytics_outbox"."event_name" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "billing_subscription" (
	"stripe_subscription_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"purchaser_user_id" text,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_item_id" text NOT NULL,
	"plan" text NOT NULL,
	"billing_period" text NOT NULL,
	"status" text NOT NULL,
	"seat_quantity" integer NOT NULL,
	"last_paid_amount" integer,
	"last_paid_currency" text,
	"last_paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscription_plan_check" CHECK ("billing_subscription"."plan" IN ('basic', 'business')),
	CONSTRAINT "billing_subscription_period_check" CHECK ("billing_subscription"."billing_period" IN ('monthly', 'yearly')),
	CONSTRAINT "billing_subscription_status_check" CHECK ("billing_subscription"."status" IN ('active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid')),
	CONSTRAINT "billing_subscription_seat_check" CHECK ("billing_subscription"."seat_quantity" > 0),
	CONSTRAINT "billing_subscription_payment_amount_check" CHECK ("billing_subscription"."last_paid_amount" IS NULL OR "billing_subscription"."last_paid_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"event_created_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_webhook_event_status_check" CHECK ("stripe_webhook_event"."status" IN ('pending', 'processed', 'blocked')),
	CONSTRAINT "stripe_webhook_event_attempt_check" CHECK ("stripe_webhook_event"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "session_ownership" ALTER COLUMN "revision_head" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_purchaser_user_id_user_id_fk" FOREIGN KEY ("purchaser_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_analytics_outbox_due_idx" ON "billing_analytics_outbox" USING btree ("delivered_at","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_organization_unique" ON "billing_subscription" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_customer_idx" ON "billing_subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "stripe_webhook_event_due_idx" ON "stripe_webhook_event" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_free_workspace_member_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	member_count integer;
BEGIN
	PERFORM pg_advisory_xact_lock(731825, hashtext(NEW.organization_id));
	IF EXISTS (
		SELECT 1
		FROM billing_subscription
		WHERE organization_id = NEW.organization_id
			AND status IN ('active', 'trialing')
	) THEN
		RETURN NEW;
	END IF;
	SELECT COUNT(*)::integer INTO member_count
	FROM member
	WHERE organization_id = NEW.organization_id;
	IF member_count >= 3 THEN
		RAISE EXCEPTION 'Free workspaces support up to 3 members'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER member_free_workspace_limit
BEFORE INSERT ON member
FOR EACH ROW
EXECUTE FUNCTION enforce_free_workspace_member_limit();
