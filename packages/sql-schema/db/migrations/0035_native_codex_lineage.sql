ALTER TABLE "session_ownership"
	ADD COLUMN "agent_source" text,
	ADD COLUMN "native_parent_session_id" text,
	ADD COLUMN "native_subagent_model" text,
	ADD COLUMN "native_subagent_path" text,
	ADD COLUMN "native_lineage_projected_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "session_ownership_native_parent_idx"
	ON "session_ownership" USING btree (
		"organization_id",
		"user_id",
		"native_parent_session_id"
	)
	WHERE "native_parent_session_id" IS NOT NULL;
