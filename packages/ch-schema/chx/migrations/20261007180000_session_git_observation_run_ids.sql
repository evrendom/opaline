-- Additive migration. Apply before deploying git extractor version 3.
-- The CI run id a CI status read names; empty for every other observation.
ALTER TABLE rudel.session_git_observations
 ADD COLUMN IF NOT EXISTS run_id String COMMENT 'CI run id a CI status read names (gh run view or watch <id>, MCP run_id); empty otherwise.';
