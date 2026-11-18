-- Run index 7: a run, and each of its requests, ends at its last activity
-- record — the prompt, the model's responses and calls, their results and
-- file changes — not at a compaction or injected context. A local command
-- run between two runs (`/compact` the next morning, before the next prompt)
-- is filed under the run before it with the context it injects, and stretched
-- a run answered in five minutes over the night (docs/l1-literal-schema.md,
-- `runs`). The rule is the build's (RUN_INDEX_VERSION 7); this migration only
-- says so in the columns' comments. Comments are metadata: no data is
-- rewritten. Applied by scripts/migrate-run-activity-end.ts.

ALTER TABLE rudel.run_index
    COMMENT COLUMN ended_at 'Timestamp of the run\'s last activity record (not metadata, a compaction or injected context); started_at when it has none.',
    COMMENT COLUMN minutes 'Wall-clock minutes from the first record to the last activity record (not metadata, a compaction or injected context).',
    COMMENT COLUMN active_minutes 'Sum of the gaps between activity records, each capped at five minutes.';

ALTER TABLE rudel.run_requests
    COMMENT COLUMN ended_at 'Time of the request\'s last activity record (not metadata, a compaction or injected context).';

ALTER TABLE rudel.weekly_totals
    COMMENT COLUMN minutes 'Wall-clock minutes of the runs of the row, each from its first record to its last activity record.',
    COMMENT COLUMN active_minutes 'Active minutes of the runs of the row: gaps between activity records, each capped at five minutes.';

ALTER TABLE rudel.analysis_finding_runs
    COMMENT COLUMN minutes 'Wall-clock minutes from the first record to the last activity record (not metadata, a compaction or injected context). Copied from the run\'s committed run index build when the analysis was saved.',
    COMMENT COLUMN active_minutes 'Sum of the gaps between activity records, each capped at five minutes. Copied from the run\'s committed run index build when the analysis was saved.';
