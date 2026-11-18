-- Run index columns for who approved a run's calls and what limits held it
-- up (capture matrix NEW-8). Claude Code records on each tool result who
-- decided its permission (permissionDecision source user_temporary,
-- user_permanent, hook or config): the run counts the calls each one
-- accepted (approvals_by_user, approvals_by_hook, approvals_by_config) and
-- the calls a person decided at a prompt while the agent waited
-- (permission_prompts, rejections included). Codex reports its rate-limit
-- windows on every token count: the run keeps the highest used_percent
-- (rate_limit_max_used_percent), and whether a request of the run was
-- refused for a rate or usage limit (rate_limited). And every effort the
-- run used (efforts), where effort keeps only the first. The run index
-- build writes them; runs of older builds keep the defaults (NULL, empty)
-- until their session is rebuilt, which the changed build fingerprint
-- triggers. Adding columns is a metadata change on a small table. Applied
-- by scripts/migrate-run-index-approvals.ts.

ALTER TABLE rudel.run_index
    ADD COLUMN IF NOT EXISTS efforts Array(LowCardinality(String)) COMMENT 'Every effort recorded in the run (Claude assistant effort, Codex turn_context effort), sorted: more than one when the effort changed within the run, whose effort column holds only the first. Empty when none was recorded, and on runs built before the column existed.' AFTER effort,
    ADD COLUMN IF NOT EXISTS approvals_by_user Nullable(UInt32) COMMENT 'Calls whose result records a permission decision the user accepted (Claude Code permissionDecision accept with source user_temporary, allowed once at a prompt, or user_permanent, allowed at a prompt from then on, which also marks the later calls the rule it saved allows, with reasonType rule; permission_prompts counts only the prompts). NULL when the agent records no permission decisions: Codex, Claude Code before 2.1.293, a run none of whose results records one (some subagent streams write none), and runs built before the column existed.' AFTER timed_out_calls,
    ADD COLUMN IF NOT EXISTS approvals_by_hook Nullable(UInt32) COMMENT 'Calls whose result records a permission decision a hook accepted (permissionDecision accept with source hook). NULL when the agent records no permission decisions: Codex, Claude Code before 2.1.293, a run none of whose results records one (some subagent streams write none), and runs built before the column existed.' AFTER approvals_by_user,
    ADD COLUMN IF NOT EXISTS approvals_by_config Nullable(UInt32) COMMENT 'Calls whose result records a permission decision configuration accepted without asking (permissionDecision accept with source config: the permission mode, reasonType mode; the auto mode classifier, classifier; an allow rule, rule). NULL when the agent records no permission decisions: Codex, Claude Code before 2.1.293, a run none of whose results records one (some subagent streams write none), and runs built before the column existed.' AFTER approvals_by_hook,
    ADD COLUMN IF NOT EXISTS permission_prompts Nullable(UInt32) COMMENT 'Calls a person decided at a permission prompt while the agent waited: accepted (permissionDecision source user_temporary or user_permanent without a reasonType; with reasonType rule a saved rule decided and nobody was asked) or rejected (denial_kind user-rejected). The wait is in the call\'s own time. NULL when the agent records no permission decisions: Codex, Claude Code before 2.1.293, a run none of whose results records one (some subagent streams write none), and runs built before the column existed.' AFTER approvals_by_config,
    ADD COLUMN IF NOT EXISTS rate_limit_max_used_percent Nullable(Float64) COMMENT 'The highest used_percent of a provider rate-limit window that the run\'s records report (Codex token_count rate_limits, primary and secondary windows). The windows are the account\'s (5 hours, 7 days), so other sessions\' use counts too, and 100 is a full window, not a refused request (rate_limited says that). NULL when no record of the run reports one (Codex versions or plans that write none; Claude Code reports quota only with a refused request), and on runs built before the column existed.' AFTER retry_attempts,
    ADD COLUMN IF NOT EXISTS rate_limited Nullable(Bool) COMMENT 'true when a record of the run says a request was refused for a rate or usage limit: a Claude Code API error rate_limit (HTTP 429) or quotaLimits status rejected, a Codex turn error usage_limit_exceeded; false when none says so. A limit the agent waited out without such a record is not seen. NULL when the parser version cannot record it, and on runs built before the column existed.' AFTER rate_limit_max_used_percent;
