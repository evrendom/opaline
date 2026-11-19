-- Analysis log (ADR 0001 as amended). Account deletion removes a stored sql
-- result that only counted the account's sessions instead of deleting it
-- (output NULL, removed_at set; its title and SQL stay unless they carry
-- text). Results record whether their rows carried transcript text (counts
-- = false: account deletion deletes them) and whether their SQL does. A
-- share or unshare requests a sync of the analysis's ClickHouse finding rows
-- in analysis_visibility_sync, retried by the minute maintenance. A new
-- table, nullable/constant-default columns and a dropped NOT NULL: catalog
-- changes only; the short lock wait keeps a busy table from queueing
-- requests behind it.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "analysis_visibility_sync" (
	"analysis_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"ticket" bigint DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_sql_result" ALTER COLUMN "output" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_sql_result" ADD COLUMN "counts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_sql_result" ADD COLUMN "query_carries_text" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_sql_result" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analysis_visibility_sync" ADD CONSTRAINT "analysis_visibility_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_visibility_sync_next_attempt_idx" ON "analysis_visibility_sync" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "analysis_visibility_sync_organization_idx" ON "analysis_visibility_sync" USING btree ("organization_id");