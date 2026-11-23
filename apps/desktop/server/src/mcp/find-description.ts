const FIND_LINES = [
	"What it does: Finds where the team's agents got stuck, failed or wasted time and money, so the team can fix their setup.",
	"Use when: Start here for questions about how agents worked, then read a few runs it points to.",
	"Returns: Period totals and runs, failure causes, unhappy prompts, git events, weekly totals or calls.",
	"Side effects: Saves what it found in the answer being worked on, deleted after 7 days if never saved. Nobody can see this unfinished answer, not even the user, until save_answer saves it.",
	"Limits: Every member sees every member's sessions in the workspace; 200 rows a call.",
];

const FIND_RETRO_LINES = [
	...FIND_LINES,
	"",
	"CRITICAL: Be minimalist. Only include filters that are essential to the user's question; the defaults and the plain arguments (repository, agent, sessionId) usually suffice.",
	"",
	"Filters: filters is a list of {key, operator, value}, all of which must hold. key is a column of the view behind source: runs, tool, user and git filter the runs view (a failure, event or git event stays when its run matches), calls filters the calls view. Operators by column type:",
	"- string: exact, is_not (one value or an array), icontains, not_icontains, regex, not_regex (ClickHouse re2, up to 800 characters, (?i) for any case), is_set, is_not_set (empty counts as not set)",
	"- number: exact (one value or an array), gt, lt, is_set, is_not_set",
	"- date: is_date_exact (YYYY-MM-DD), is_date_before, is_date_after",
	"- boolean: exact (true or false; unknown matches neither)",
	"- array (skills, mcp_servers, coverage_gaps): icontains, not_icontains (any element), is_set, is_not_set (empty)",
	"Do not check that a column is set unless the user asks. Time ranges go in from and to, never in filters.",
	"Values: DO NOT GUESS. Run schema view=runs column=<key> (or view=calls) for a column's type, meaning and top values before filtering on it; where schema is not among your tools, copy values from an earlier find result.",
	"Sessions and subagents: agent_id is_not_set keeps the main agent, is_set its subagents; parentSessionId is a session and every session it spawned, in one call.",
	"",
	"Pagination: limit (default 50) with offset, or the cursor the last line names; the header says hasMore=true or false. sort=random (source=runs or calls) gives an unbiased sample instead of the newest; it is a new sample each call, so page it with its cursor, not offset.",
	"Data: no bulk export here; never page through many cursors. When more pages follow, the result names the opaline CLI command that pulls the same sessions to local files (opaline pull --repo … --from … --to …): where a shell has the CLI, run it once and compute on the files.",
	"",
	"Examples:",
	'- Expensive runs whose prompt asks to deploy: {"source":"runs","filters":[{"key":"cost_usd","operator":"gt","value":5},{"key":"prompt_head","operator":"regex","value":"(?i)deploy"}]}',
	'- Commands that keep failing, with their own time and their runs\' time: {"source":"calls","groupBy":"commandFingerprint","filters":[{"key":"failed","operator":"exact","value":true}]}',
	'- A random sample of the main agent\'s runs: {"source":"runs","sort":"random","limit":20,"filters":[{"key":"agent_id","operator":"is_not_set"}]}',
	"",
	"Reminders:",
	"- A list is not evidence: open the runs it points to with read or run before naming a cause.",
	"- When a failure keeps happening, offer to save it as a check.",
	"- Avoid stacking filters; the simplest call that answers the question is best.",
];

const SESSIONS_REMINDER =
	"To list the sessions behind a group (a failure cause, a command, a kind of prompt), use groupBy=session instead of calling find once per session.";

const RETRO_EXAMPLES = [
	'- The sessions one failure cause hit, each with its first and last hit: {"source":"tool","cause":"hook: package policy blocked an install","groupBy":"session"}',
	'- The sessions behind one command fingerprint: {"source":"calls","commandFingerprint":"<from an earlier result>","groupBy":"session"}',
];

function retroLines(): string[] {
	const lines = FIND_RETRO_LINES.map((line) =>
		line.startsWith("Use when: ") ? `${line} ${SESSIONS_REMINDER}` : line,
	);
	const reminders = lines.indexOf("Reminders:");
	return [
		...lines.slice(0, reminders - 1),
		...RETRO_EXAMPLES,
		"",
		"Reminders:",
		`- ${SESSIONS_REMINDER} measures action=run takes drill for the sessions behind one row of a measure.`,
		...lines.slice(reminders + 1),
	];
}

export const FIND_DESCRIPTION = FIND_LINES.join("\n");

export const FIND_RETRO_DESCRIPTION = retroLines().join("\n");

export const FIND_GROUP_BY_DESCRIPTION =
	"source=runs: totals per week, model, repository, agent or session instead of one row per run. source=weekly: totals per week, member or agent instead of one row per week, member and agent. source=calls: counts per commandFingerprint (the same command), commandArgv0 (program) or commandPrefix (first words), with failed calls and example texts.";

export const FIND_RETRO_GROUP_BY_DESCRIPTION = `${FIND_GROUP_BY_DESCRIPTION} source=tool, user or calls: session gives one row per session behind the matched failures, prompts or calls, with rows, first and last time, groupRunTime, groupCallTime, failed calls and one example, and the totals first; use it instead of calling once per session.`;

export const FIND_PUBLISHED_SORTS = [
	"startedAt",
	"minutes",
	"costUsd",
	"failedCalls",
	"rawChars",
] as const;

export const FIND_INPUT_DESCRIPTIONS: Record<string, string> = {
	source:
		"Required. runs: one row per run with its time and cost. tool: failed tool calls grouped by cause. user: prompts where the user was unhappy with the agent (corrections, complaints) and agent apologies. git: commits, pushes, PR links and creations, CI status reads and Codex git metadata, each with the pull requests and CI runs GitHub links to it and whether CI was checked after a push; with pullRequest, the sessions that touched that pull request. weekly: per ISO week, member and agent, the sums of the runs' recorded facts (runs, sessions, minutes, cost and tokens, calls, failures, denials, interruptions, API errors, pushes, commits, PR links, MCP calls, skills), from a nightly snapshot; use it for trends over weeks or months and for before/after comparisons. calls: shell commands, Codex code-mode scripts and written script files, each with its program, first words, fingerprint (the same command with incidental values such as paths, numbers, ids and quoted strings replaced) and simhash (near-duplicate scripts), whether it failed, and its text.",
	from: "First day, YYYY-MM-DD (UTC). Default: 6 days before to (source=weekly: the 11 weeks before the week of to). For totals and rankings, use the start of the window the user asked for. source=weekly counts whole weeks from the Monday on or before it.",
	to: "Last day, YYYY-MM-DD (UTC). Default: today.",
	latest: "Only the newest N sessions in the date range, 1-200.",
	repository:
		"Only sessions in this repository (a name from the repository column). Not for source=weekly.",
	agent: "Only sessions from claude_code, codex or gemini. Default: all.",
	model:
		"Only runs that used this model id; cost then counts only that model. Not for source=calls: find those runs first and pass them.",
	sessionId: "Only this session and the subagents it started.",
	toolGroup:
		"source=tool only: shell, edit, read, search, browser, web, mcp, subagent or other.",
	commandClass:
		"source=tool only, shell failures: test, build, lint, typecheck, git, migrate, install or other.",
	kind: "source=tool only: friction (blocked by a hook or policy), mistake (wrong path, stale patch, bad flag), validation (tests, types, lint or build failed), environment (missing tool or service), noise (expected failures, hidden by default) or other.",
	cause: "source=tool only: only this cause, copied from an earlier result.",
	detail:
		"source=tool only: only this detail (lint rule, error code), copied from an earlier result.",
	includeNoise: "source=tool only: also show expected failures. Default false.",
	commandFrom:
		"source=calls only: command (a shell command, or a Codex code-mode script that runs exactly one), script (any other Codex code-mode script) or written (a script file a call wrote).",
	commandArgv0:
		"source=calls only: only commands that run this program, as in the argv0 column (git, bun, python3).",
	commandPrefix:
		"source=calls only: only commands with these first words, as in the prefix column (git push, gh pr).",
	commandFingerprint:
		"source=calls only: only calls with this fingerprint, copied from an earlier result.",
	commandSimhash:
		"source=calls only: only near-duplicates of a script, a simhash copied from an earlier result (calls whose simhash differs in at most 3 of 32 bits; texts under 20 words have none).",
	reaction:
		"source=user only: negative (unhappy prompts), swear (strongly worded complaints), apology (the agent apologized). Default: all three.",
	groupBy: FIND_GROUP_BY_DESCRIPTION,
	refs: "Only these runs (at most 200), as given by an earlier result; with source=runs this returns their total time and cost.",
	"refs[].sessionId": "The run's session id.",
	"refs[].agentId":
		"Empty (default) for the main agent, else the subagent's id.",
	"refs[].turn": "The run's number in the session, from 1.",
	limit: "Rows per call, 1-200. Default 50, or 20 for source=tool.",
	sort: "source=runs order, biggest first: startedAt (default, newest first), minutes, costUsd, failedCalls or rawChars (size of the run's text).",
	cursor:
		"The value from an earlier result's 'more: pass cursor=…' line, to get the next page with the same other arguments.",
	pullRequest:
		"source=git only: a pull request as owner/name#number or its GitHub URL. Returns the events of every session that named it, pushed its head branch, or created, pushed or mentioned one of its commits, whatever their date unless from or to is given.",
};

export const FIND_RETRO_INPUT_DESCRIPTIONS: Record<string, string> = {
	...FIND_INPUT_DESCRIPTIONS,
	groupBy: FIND_RETRO_GROUP_BY_DESCRIPTION,
	parentSessionId:
		"This session and every session it spawned, every level down (Codex subagent threads, forks, and one agent started by the other), whatever their date unless from or to is given. Each row's parentSessionId says which session spawned it. Not with sessionId.",
	filters:
		"Columns that must match, all of them (see Filters above). Not for source=weekly.",
	"filters[].key":
		"A column of the runs view (source=runs, tool, user, git) or the calls view (source=calls), as schema lists it: repository, cost_usd, prompt_head, agent_id, failed, call_minutes.",
	"filters[].operator":
		"exact, is_not, icontains, not_icontains, regex, not_regex, is_set, is_not_set for text; exact, gt, lt, is_set, is_not_set for numbers; is_date_exact, is_date_before, is_date_after for times; exact for true or false; icontains, not_icontains, is_set, is_not_set for lists.",
	"filters[].value":
		"The value to compare with; an array for exact or is_not to match any of several; none for is_set and is_not_set. Copy values from schema view=… column=…, never guess them.",
	limit:
		"Rows per call, 1-200. Default 50, or 20 for source=tool. A page also stops at 80,000 characters (60,000 for verbosity summary); a marker counts the rows left out and the cursor continues with them.",
	sort: "source=runs order, biggest first: startedAt (default, newest first), minutes, costUsd, failedCalls or rawChars (size of the run's text). random: an unbiased sample of runs, or of calls with source=calls, after the filters.",
	offset:
		"Items to skip before this page, 0-10000, to page by position; a cursor wins when both are given.",
	cursor:
		"The cursor from an earlier result's last line ('call find again with the same arguments and cursor=…'), to get the next page with the same other arguments.",
	verbosity:
		"full (default): every column. summary: ids, times, counts, cost, models, repositories and cause labels, without free text (promptHead, quote, command, topCommands, examples, ciRuns); the result names what it left out. Use summary to survey, then full for the rows you need.",
};
