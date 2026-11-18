ALTER TABLE "session_ownership"
	ADD COLUMN "native_lineage_projected_signature" text,
	ADD COLUMN "arrival_notified_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "session_ownership"
SET "arrival_notified_at" = "last_usage_completed_at"
WHERE "last_usage_completed_at" IS NOT NULL;
