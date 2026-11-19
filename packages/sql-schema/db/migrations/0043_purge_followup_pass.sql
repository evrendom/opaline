ALTER TABLE "clickhouse_purge_job" ADD COLUMN "followup_due_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "clickhouse_purge_job" ADD COLUMN "followup_completed_at" timestamp with time zone;