CREATE TABLE "github_webhook_delivery" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"repository_id" text,
	"event" text NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"outcome" text NOT NULL,
	"affected_rows" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_webhook_delivery_id_check" CHECK ("github_webhook_delivery"."delivery_id" ~ '^[A-Za-z0-9-]{1,64}$'),
	CONSTRAINT "github_webhook_delivery_outcome_check" CHECK ("github_webhook_delivery"."outcome" IN ('refresh_scheduled', 'installation_updated', 'no_op')),
	CONSTRAINT "github_webhook_delivery_affected_rows_check" CHECK ("github_webhook_delivery"."affected_rows" >= 0)
);
--> statement-breakpoint
ALTER TABLE "github_webhook_delivery" ADD CONSTRAINT "github_webhook_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_webhook_delivery_received_idx" ON "github_webhook_delivery" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "github_webhook_delivery_organization_idx" ON "github_webhook_delivery" USING btree ("organization_id");