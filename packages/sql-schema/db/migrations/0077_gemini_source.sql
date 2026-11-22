-- Gemini sessions (Gemini CLI and Antigravity) are a third source, and
-- rudel.gemini_sessions a third raw session table. Online-safe like 0053:
-- drizzle runs every pending migration in one transaction, so each check is
-- swapped NOT VALID under a short lock wait (no scan while ACCESS EXCLUSIVE
-- is held), and `bun run migrate` validates them afterwards
-- (src/post-migrate.ts). The new checks only widen the old ones.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ingest_job"
	DROP CONSTRAINT "ingest_job_source_check",
	ADD CONSTRAINT "ingest_job_source_check"
		CHECK ("ingest_job"."source" IN ('claude_code', 'codex', 'gemini')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ingest_processing_target_receipt"
	DROP CONSTRAINT "ingest_processing_target_receipt_target_check",
	ADD CONSTRAINT "ingest_processing_target_receipt_target_check"
		CHECK ("ingest_processing_target_receipt"."target" IN (
				'rudel.claude_sessions',
				'rudel.codex_sessions',
				'rudel.gemini_sessions',
				'rudel.session_language_signals',
				'rudel.skill_receipts',
				'rudel.skill_uses',
				'rudel.skill_version_contents',
				'rudel.usage_events'
			)) NOT VALID;--> statement-breakpoint
ALTER TABLE "l1_edge_scope"
	DROP CONSTRAINT "l1_edge_scope_kind_check",
	ADD CONSTRAINT "l1_edge_scope_kind_check"
		CHECK (("l1_edge_scope"."scope_kind" IN ('session', 'run_index') AND "l1_edge_scope"."user_id" IS NOT NULL AND "l1_edge_scope"."session_id" IS NOT NULL AND "l1_edge_scope"."source" IN ('claude_code', 'codex', 'gemini')) OR ("l1_edge_scope"."scope_kind" = 'repository' AND "l1_edge_scope"."repository_id" IS NOT NULL AND "l1_edge_scope"."user_id" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "live_session"
	DROP CONSTRAINT "live_session_source_check",
	ADD CONSTRAINT "live_session_source_check"
		CHECK ("live_session"."source" IN ('claude_code', 'codex', 'gemini')) NOT VALID;--> statement-breakpoint
ALTER TABLE "repository_evidence_capture"
	DROP CONSTRAINT "repository_evidence_capture_source_check",
	ADD CONSTRAINT "repository_evidence_capture_source_check"
		CHECK ("repository_evidence_capture"."source" IN ('claude_code', 'codex', 'gemini')) NOT VALID;
