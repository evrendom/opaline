-- Additive migration. Apply before deploying run indexing and dashboard queries.
-- One tuple per run: anchor ID, start time, elapsed seconds (-1 = unknown),
-- model, recorded skill use, and signal in the immediately following user reply.
-- The existing revisioned summary replaces the whole array on subsequent uploads.
ALTER TABLE rudel.session_language_signals
 ADD COLUMN IF NOT EXISTS agent_runs Array(Tuple(String, DateTime64(3, 'UTC'), Float64, String, UInt8, String)) DEFAULT [];
