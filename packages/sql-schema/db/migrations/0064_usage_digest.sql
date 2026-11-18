-- Usage digest emails: each member's daily and weekly choice per workspace,
-- the send queue the hourly cron claims (one row per workspace, kind and
-- period), who already got each digest, and the time zone each user was last
-- seen in (the digests go out at 09:00 there). The new tables' foreign keys
-- and the nullable column briefly lock organization and user, so a short lock
-- wait keeps busy tables from queueing requests.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "usage_digest" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"recipients" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "usage_digest_kind_check" CHECK ("usage_digest"."kind" IN ('daily', 'weekly')),
	CONSTRAINT "usage_digest_status_check" CHECK ("usage_digest"."status" IN ('pending', 'claimed', 'done'))
);
--> statement-breakpoint
CREATE TABLE "usage_digest_delivery" (
	"digest_id" text NOT NULL,
	"user_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_digest_delivery_digest_id_user_id_pk" PRIMARY KEY("digest_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "usage_digest_preference" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"daily" boolean DEFAULT true NOT NULL,
	"weekly" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_digest_preference_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "usage_digest" ADD CONSTRAINT "usage_digest_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_digest_delivery" ADD CONSTRAINT "usage_digest_delivery_digest_id_usage_digest_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."usage_digest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_digest_delivery" ADD CONSTRAINT "usage_digest_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_digest_preference" ADD CONSTRAINT "usage_digest_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_digest_preference" ADD CONSTRAINT "usage_digest_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_digest_period_unique" ON "usage_digest" USING btree ("organization_id","kind","period_start");--> statement-breakpoint
CREATE INDEX "usage_digest_status_idx" ON "usage_digest" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_digest_preference_organization_id_idx" ON "usage_digest_preference" USING btree ("organization_id");