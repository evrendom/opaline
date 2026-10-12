-- OPL-387: what a run's messages literally say, for the approved measures
-- (apps/api/src/services/analysis/sql-measures.ts): the word-list categories
-- of the run's first genuine prompt, the message the agent ended the run
-- with and whether it was kept whole, and whether the stream recorded its
-- system prompt by then (coverage evidence the runs view would otherwise
-- read from every transcript record of the workspace). The rules that read
-- them (frustration, said done, re-ask) live in the SQL views, so changing
-- one rebuilds nothing. Run index 4 writes them; runs of older builds keep
-- the defaults, which the views read as unknown, until their session is
-- rebuilt. Adding columns is a metadata change on a small table. Applied by
-- scripts/migrate-run-index-messages.ts.

ALTER TABLE rudel.run_index
    ADD COLUMN IF NOT EXISTS prompt_reactions Array(LowCardinality(String)) COMMENT 'Word-list categories (negative, swear, apology, positive) the language-signals scanner finds in the run\'s first genuine prompt (its first 16,384 characters, as find scans it), sorted; empty when it finds none or the run has none. From run index 4; empty before.' AFTER genuine_prompts,
    ADD COLUMN IF NOT EXISTS final_message Nullable(String) COMMENT 'First 2,000 characters of the run\'s last assistant text when no tool call follows it in the run: what the agent said when it stopped. NULL when the run ended on a tool call, has no assistant text, or was built before run index 4.' AFTER prompt_reactions,
    ADD COLUMN IF NOT EXISTS final_message_cut Bool COMMENT 'Whether final_message holds only part of the message: it was longer than 2,000 characters, or the transcript stored it cut. From run index 4; false before.' AFTER final_message,
    ADD COLUMN IF NOT EXISTS system_prompt_recorded Bool COMMENT 'Whether the run\'s stream recorded the system prompt it received (a Claude Code prompt_snapshot attachment or Codex base instructions) at or before the run. From run index 4; false before.' AFTER final_message_cut;
