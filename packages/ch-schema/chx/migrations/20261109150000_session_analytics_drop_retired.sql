-- Retirement step 3 (docs/l1-literal-schema.md): drop the retired columns that
-- held chkit's quoted defaults ('standard' and '') until 20261106120000. No view
-- writes them since 20261008120000. Applied by
-- scripts/migrate-session-analytics-drop-retired.ts, which first checks that no
-- view on any replica names them.

ALTER TABLE rudel.session_analytics
    DROP COLUMN IF EXISTS error_pattern,
    DROP COLUMN IF EXISTS session_archetype;
