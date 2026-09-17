-- Apply before deploying the version-4 language scanner and dashboard queries.
-- Existing reconciliation appends fresh summaries for older scan versions.
ALTER TABLE rudel.session_language_signals
    ADD COLUMN IF NOT EXISTS member_negative UInt32 DEFAULT 0;
