-- Apply before deploying scan version 5 or dashboard verbatim filters.
-- Reconciliation appends fresh summaries; older rows remain explicitly unindexed.
ALTER TABLE rudel.session_language_signals
 ADD COLUMN IF NOT EXISTS model_apology_counts Map(String, UInt32) DEFAULT map(),
 ADD COLUMN IF NOT EXISTS member_negative_counts Map(String, UInt32) DEFAULT map(),
 ADD COLUMN IF NOT EXISTS member_positive_counts Map(String, UInt32) DEFAULT map();
