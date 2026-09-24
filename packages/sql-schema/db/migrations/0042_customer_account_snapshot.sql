CREATE TABLE "customer_account_snapshot" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"organization_name" text NOT NULL,
	"organization_slug" text NOT NULL,
	"organization_created_at" timestamp with time zone NOT NULL,
	"billing_plan" text DEFAULT 'free' NOT NULL,
	"billing_period" text DEFAULT 'none' NOT NULL,
	"subscription_status" text DEFAULT 'none' NOT NULL,
	"payment_status" text DEFAULT 'free' NOT NULL,
	"seat_quantity" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"last_paid_amount" integer,
	"last_paid_currency" text,
	"last_paid_at" timestamp with time zone,
	"agent_runs_7d" integer DEFAULT 0 NOT NULL,
	"agent_runs_30d" integer DEFAULT 0 NOT NULL,
	"active_members_30d" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp with time zone,
	"usage_refreshed_at" timestamp with time zone,
	"crm_sync_pending_at" timestamp with time zone DEFAULT now() NOT NULL,
	"crm_synced_at" timestamp with time zone,
	"crm_sync_attempt_count" integer DEFAULT 0 NOT NULL,
	"crm_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"crm_last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_account_snapshot_billing_plan_check" CHECK ("customer_account_snapshot"."billing_plan" IN ('free', 'basic', 'business')),
	CONSTRAINT "customer_account_snapshot_billing_period_check" CHECK ("customer_account_snapshot"."billing_period" IN ('none', 'monthly', 'yearly')),
	CONSTRAINT "customer_account_snapshot_counts_check" CHECK ("customer_account_snapshot"."seat_quantity" >= 0 AND "customer_account_snapshot"."member_count" >= 0 AND "customer_account_snapshot"."agent_runs_7d" >= 0 AND "customer_account_snapshot"."agent_runs_30d" >= 0 AND "customer_account_snapshot"."active_members_30d" >= 0 AND "customer_account_snapshot"."crm_sync_attempt_count" >= 0)
);--> statement-breakpoint
ALTER TABLE "customer_account_snapshot" ADD CONSTRAINT "customer_account_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_account_snapshot_usage_refresh_idx" ON "customer_account_snapshot" USING btree ("usage_refreshed_at");--> statement-breakpoint
CREATE INDEX "customer_account_snapshot_crm_due_idx" ON "customer_account_snapshot" USING btree ("crm_synced_at","crm_next_attempt_at");
