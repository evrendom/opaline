-- L1 retention: raw transcripts, transcript records and the run index are kept
-- until a deletion request (docs/l1-retention.md). Owner decision, replacing
-- the 365-day TTL on the raw session tables, on transcript_records and on
-- session_lineage (L1 lineage), the 1,095-day TTL on run_index and the
-- 365-day column TTLs on its free text.
--
-- Forward only: this removes the TTLs; it cannot bring back rows a TTL merge
-- already deleted. REMOVE TTL is a metadata change (no mutation, no rewrite),
-- and it fails on a table or column without a TTL, so the runner
-- (scripts/migrate-l1-retention.ts) probes each table and column first and
-- executes only the REMOVE TTL statements that still apply. COMMENT
-- statements are idempotent. The run index comments drop the "once the text
-- retention passed" wording.

ALTER TABLE rudel.claude_sessions REMOVE TTL;

ALTER TABLE rudel.codex_sessions REMOVE TTL;

ALTER TABLE rudel.transcript_records REMOVE TTL;

ALTER TABLE rudel.run_index REMOVE TTL;

ALTER TABLE rudel.session_lineage REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN prompt_head REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN turn_error REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN hook_stop_reason REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN hook_errors REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN hook_runs REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN api_error REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN goal REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN title REMOVE TTL;

ALTER TABLE rudel.run_index MODIFY COLUMN session_date COMMENT 'Session date of the generation.';

ALTER TABLE rudel.run_index MODIFY COLUMN prompt_head COMMENT 'First 160 characters of the run\'s first genuine prompt; NULL when the run has none.';

ALTER TABLE rudel.run_index MODIFY COLUMN turn_error COMMENT 'First Codex task_complete error message of the run; NULL when the parser version or agent does not record it.';

ALTER TABLE rudel.run_index MODIFY COLUMN hook_stop_reason COMMENT 'First Claude stop hook stopReason of the run; NULL when the parser version or agent does not record it.';

ALTER TABLE rudel.run_index MODIFY COLUMN hook_errors COMMENT 'JSON array of the run\'s stop hook hookErrors in record order; NULL when the parser version or agent does not record it.';

ALTER TABLE rudel.run_index MODIFY COLUMN hook_runs COMMENT 'JSON array of the run\'s stop hook hookInfos (command, durationMs) in record order; NULL when the parser version or agent does not record it.';

ALTER TABLE rudel.run_index MODIFY COLUMN api_error COMMENT 'First Claude API error of the run; NULL when the parser version or agent does not record it.';

ALTER TABLE rudel.run_index MODIFY COLUMN goal COMMENT 'Last Codex thread goal objective set in the run; NULL when the parser version or agent does not record it.';

ALTER TABLE rudel.run_index MODIFY COLUMN title COMMENT 'Receipt: last Claude ai-title of the main stream; NULL when the parser version or agent does not record it.';
