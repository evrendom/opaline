-- chkit 0.1.0-beta.16 renders a string default as a literal and only `fn:`
-- as SQL, so the source's "'standard'" and "''" were stored with their quotes.
-- Defaults are metadata: no data is rewritten. Applied by
-- scripts/migrate-string-defaults.ts.

ALTER TABLE rudel.session_analytics
    MODIFY COLUMN source DEFAULT 'claude_code',
    MODIFY COLUMN git_remote DEFAULT '',
    MODIFY COLUMN package_name DEFAULT '',
    MODIFY COLUMN package_type DEFAULT '',
    MODIFY COLUMN error_pattern DEFAULT '',
    MODIFY COLUMN model_used DEFAULT '',
    MODIFY COLUMN session_archetype DEFAULT 'standard';

ALTER TABLE rudel.claude_sessions
    MODIFY COLUMN git_remote DEFAULT '',
    MODIFY COLUMN package_name DEFAULT '',
    MODIFY COLUMN package_type DEFAULT '';

ALTER TABLE rudel.codex_sessions
    MODIFY COLUMN git_remote DEFAULT '',
    MODIFY COLUMN package_name DEFAULT '',
    MODIFY COLUMN package_type DEFAULT '';
