-- Run index columns for gaps in what runs show (capture matrix NEW-4,
-- NEW-14, B7). Where each run worked: the directory its shell commands ran in
-- (cwd), and the repository the session's own records tie that directory to
-- (cwd_repository) with what ties it (cwd_repository_basis). The session's
-- repository column is one value per upload, so a coordinator session that
-- dispatches subagents into other checkouts put every run on one repository;
-- these columns name each run's own, or leave it unknown. And the MCP
-- servers the run's stream last recorded as needing authentication or
-- failed (mcp_unavailable), and the subtype of the prompt the run starts
-- with (prompt_subtype: a queued prompt ends the run before mid-work). The
-- run index build writes them; runs of older builds keep the defaults
-- (NULL, empty) until their session is rebuilt, which the changed build
-- fingerprint triggers. Adding columns is a metadata
-- change on a small table. Applied by scripts/migrate-run-index-capture-gaps.ts.

ALTER TABLE rudel.run_index
    ADD COLUMN IF NOT EXISTS prompt_subtype LowCardinality(Nullable(String)) COMMENT 'The subtype of the prompt the run starts with, as the parser recorded it: \'\' for a prompt sent while the agent was waiting, queued (sent while it worked: the agent reads it at its next request, so the run before ends mid-work), delegation (a parent agent\'s task to a subagent); \'\' also when the run starts with no prompt. NULL when the parser version cannot tell them apart (Claude Code subagent streams before parser 11 read a coordinator\'s message as queued), and on runs built before the column existed.' AFTER genuine_prompts,
    ADD COLUMN IF NOT EXISTS cwd Nullable(String) COMMENT 'The directory the run\'s shell commands ran in: per call, the literal directory its command starts by moving to (a leading cd, pushd or git -C; a leading ~ is the home directory of the recorded cwd, a relative one is joined to it), else the directory recorded for it (Claude Code record cwd, Codex CommandExecution cwd); the one most of the run\'s shell calls ran in, the earliest on a tie. A run without shell calls takes its first recorded cwd. NULL when none is recorded, and on runs built before the column existed.' AFTER repository,
    ADD COLUMN IF NOT EXISTS cwd_repository Nullable(String) COMMENT 'The repository (host/owner/name of its git remote) the session\'s own records tie to cwd or the deepest directory above it, as cwd_repository_basis says; NULL when nothing ties it to one, or that directory\'s records name several: unknown, not the session\'s repository.' AFTER cwd,
    ADD COLUMN IF NOT EXISTS cwd_repository_basis LowCardinality(String) COMMENT 'What ties cwd to cwd_repository, strongest first: codex_session_meta (the git remote a Codex session_meta records for its directory), session_branch (the upload\'s remote, for the session\'s own directory, where a record shows the upload\'s branch), remote_output (origin URL a call there printed), transfer_remote (the remote a git push, fetch or pull there printed), gh_output (the one repository whose pull request or Actions URLs a gh pr or gh run there printed); conflicting when the records name more than one repository; empty when none.' AFTER cwd_repository,
    ADD COLUMN IF NOT EXISTS mcp_unavailable Array(LowCardinality(String)) COMMENT 'MCP servers the stream\'s latest server-state record at or before the run\'s end lists as needing authentication or failed to connect (Claude Code deferred_tools_delta needsAuthMcpServers and failedMcpServers names), sorted; the stream\'s own records, carried from run to run until the next such record. Empty when that record lists none, or the stream recorded no server state; still connecting (pendingMcpServers) is not unavailable.' AFTER mcp_servers;
