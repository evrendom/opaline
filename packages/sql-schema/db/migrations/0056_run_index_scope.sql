-- The edge worker's queue also builds a session's run index (scope kind
-- run_index, same scope id as the session). Online-safe as in 0053: the
-- constraint is swapped NOT VALID under a short lock wait, and `bun run
-- migrate` validates it afterwards in its own transaction
-- (src/post-migrate.ts). Existing rows all satisfy the wider check.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "l1_edge_scope"
	DROP CONSTRAINT "l1_edge_scope_kind_check",
	ADD CONSTRAINT "l1_edge_scope_kind_check"
		CHECK (("l1_edge_scope"."scope_kind" IN ('session', 'run_index') AND "l1_edge_scope"."user_id" IS NOT NULL AND "l1_edge_scope"."session_id" IS NOT NULL AND "l1_edge_scope"."source" IN ('claude_code', 'codex')) OR ("l1_edge_scope"."scope_kind" = 'repository' AND "l1_edge_scope"."repository_id" IS NOT NULL AND "l1_edge_scope"."user_id" IS NULL)) NOT VALID;
