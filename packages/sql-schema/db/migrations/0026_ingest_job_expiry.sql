ALTER TABLE "ingest_job" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "ingest_job"
SET "expires_at" = "created_at" + INTERVAL '24 hours'
WHERE "expires_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "ingest_job"
	ALTER COLUMN "expires_at" SET DEFAULT NOW() + INTERVAL '24 hours',
	ALTER COLUMN "expires_at" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "ingest_job_expiry_idx"
	ON "ingest_job" USING btree ("expires_at")
	WHERE "status" IN ('pending', 'running');
