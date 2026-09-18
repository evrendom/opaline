ALTER TABLE "session_ownership"
	ADD COLUMN "agent_metadata_scanned_at" timestamp with time zone,
	ADD COLUMN "agent_metadata_scan_outcome" text;
--> statement-breakpoint
CREATE INDEX "session_ownership_agent_metadata_scan_idx"
	ON "session_ownership" USING btree (
		"created_at" DESC,
		"organization_id",
		"user_id",
		"session_id"
	)
	WHERE "agent_source" IS NULL
		AND "agent_metadata_scanned_at" IS NULL;
