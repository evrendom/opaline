-- Parser 12: each transcript record carries its line's own id as the agent
-- wrote it (Claude Code `uuid`), so an agent holding that id can open the
-- record through the run tool instead of searching the raw transcript files.
-- The bloom filter skip index lets a lookup inside one workspace read only
-- the granules of the workspace's key range that may hold the id. Additive:
-- rows written before parser 12 read the empty default, which readers report
-- as unknown, not missing. ADD COLUMN and ADD INDEX are metadata changes; no
-- MATERIALIZE INDEX, because older parts hold only the empty default and the
-- re-index writes new parts, which build the index as they are written.
-- Applied by scripts/migrate-transcript-record-uuid.ts.

ALTER TABLE rudel.transcript_records
    ADD COLUMN IF NOT EXISTS record_uuid String COMMENT 'The line\'s own id as the agent wrote it (Claude Code uuid), the same on every record of the line; empty when the line has none (Codex) and on rows before parser 12, which is unknown, not missing.' AFTER call_id;

ALTER TABLE rudel.transcript_records
    ADD INDEX IF NOT EXISTS record_uuid_bloom (record_uuid) TYPE bloom_filter(0.01) GRANULARITY 1;
