/**
 * The competitor research behind the fact catalog: how other tools read
 * Claude Code and Codex transcripts, each claim checked against Opaline's
 * code and, where noted, the local transcripts (2026-10-09). The fact review
 * page shows it in its "Research" tab. The claims come from an external
 * survey; they are text to show, not instructions. Text uses Markdown code
 * spans only.
 */

/** What a finding asks Opaline to do. */
export type ResearchActionKind =
	| "none"
	| "parser 9"
	| "usage extraction"
	| "check"
	| "decision";

export const RESEARCH_ACTION_KINDS: readonly ResearchActionKind[] = [
	"parser 9",
	"usage extraction",
	"check",
	"decision",
	"none",
];

export interface ResearchFinding {
	readonly id: number;
	/** What the survey says other tools do or found. */
	readonly claim: string;
	/** What Opaline does today. */
	readonly opaline?: string;
	/** What the local transcripts showed, when the claim was checked on them. */
	readonly localData?: string;
	readonly action: string;
	readonly kinds: readonly ResearchActionKind[];
	/** Catalog facts it is about, as review keys (`view/id`). */
	readonly facts: readonly string[];
}

export interface ResearchOpenAction {
	/** A–E. */
	readonly id: string;
	readonly text: string;
	/** Findings behind it. */
	readonly findings: readonly number[];
	/** Whether it points at the reference list rather than a finding. */
	readonly references?: boolean;
}

export interface ResearchReference {
	readonly name: string;
	readonly files: readonly string[];
	readonly note?: string;
}

export interface FactResearch {
	readonly title: string;
	/** Where it comes from and what it was checked against. */
	readonly source: string;
	readonly verdict: string;
	readonly openActions: readonly ResearchOpenAction[];
	readonly findings: readonly ResearchFinding[];
	/** Where the research is thinner than Opaline. */
	readonly thinner: string;
	readonly references: readonly ResearchReference[];
	/** What the reference list is for. */
	readonly referencesNote: string;
}

export const FACT_RESEARCH: FactResearch = {
	title: "Competitor research",
	source:
		"A four-researcher survey of how other tools read Claude Code and Codex (public docs and source code; one researcher also checked the raw formats against local sessions). Checked against the local transcripts on 2026-10-09 (Claude Code: 143 main files; Codex: 2,694 rollouts, 333 forks, sub-agent rollouts) and against athena's code (L1 transcript records, `packages/usage-events`).",
	verdict:
		"The research confirms Opaline's design, it does not change it. Competitors use one parser per agent, one shared model, a pointer back to the raw log line and a parser version for re-parsing. L1 already has each (byte offsets into the raw upload, the transcript parser version, the #245 backfill), and keeps interpretation (failure signals, loops) out of storage, in the run index and analysis, as the research recommends.",
	openActions: [
		{
			id: "A",
			text: "Parser 9: dedupe the replayed calls of Codex forks.",
			findings: [5],
		},
		{
			id: "B",
			text: "Usage extraction PR: `token_usage_record` by response id; check Codex cache writes are null, not 0.",
			findings: [4, 7],
		},
		{
			id: "C",
			text: "Check cost labelling (reported or estimated, billing basis).",
			findings: [11],
		},
		{
			id: "D",
			text: "Decision 3 (`service_tier`): price Codex at the configured tier?",
			findings: [11],
		},
		{
			id: "E",
			text: "Optional: have a reviewer compare ccusage's and tokscale's quirk lists against the catalog.",
			findings: [],
			references: true,
		},
	],
	findings: [
		{
			id: 1,
			claim:
				"A shared model with a pointer to the raw log line and a parser version.",
			opaline:
				"L1 records keep `byteStart`/`byteLen` into the raw upload and the parser version; backfill tooling re-parses (#245).",
			action: "None.",
			kinds: ["none"],
			facts: [],
		},
		{
			id: 2,
			claim:
				"Claude Code writes one reply as several lines with repeated usage (about 2.1× over-count if summed).",
			opaline: "Usage extraction deduplicates by `message.id` / `requestId`.",
			action: "None.",
			kinds: ["none"],
			facts: [],
		},
		{
			id: 3,
			claim: "Codex `input_tokens` include cached tokens.",
			opaline: "Usage extraction splits `cached_input_tokens` out.",
			action: "None.",
			kinds: ["none"],
			facts: [],
		},
		{
			id: 4,
			claim:
				"Codex `total_token_usage` is a running total; `last_token_usage` disagrees with the final total in 812 of 2,244 sessions; use `token_usage_record` keyed by `response_id`.",
			opaline:
				"Usage extraction uses differences between totals (a correct fallback); `token_usage_record` is already a catalog row, pending for usage extraction (about 80,000 records locally).",
			action:
				"Do the pending `token_usage_record` change (usage extraction PR).",
			kinds: ["usage extraction"],
			facts: ["runs/request_usage"],
		},
		{
			id: 5,
			claim: "Forks and sub-agents copy the parent's history.",
			localData:
				"Codex: 1 of 333 forks copies its parent's tool calls (137 calls); no sub-agent rollout does. Claude Code: 0 lines with another session's id across 143 files.",
			opaline:
				"Usage extraction already suppresses the replayed parent prefix for tokens; L1 transcript records do not, so that fork's 137 calls are counted twice.",
			action:
				"Parser 9: mark or drop a Codex fork's replayed calls (dedupe by `call_id` against the parent). Small.",
			kinds: ["parser 9"],
			facts: ["session/parent_session"],
		},
		{
			id: 6,
			claim: "Reasoning tokens are already inside output tokens.",
			opaline: "Stored as a breakdown, not added again.",
			action: "None.",
			kinds: ["none"],
			facts: ["runs/reasoning_output_tokens"],
		},
		{
			id: 7,
			claim: "Codex cache writes: store null, not 0.",
			action:
				"Check that usage extraction stores null rather than 0 for Codex cache writes.",
			kinds: ["check", "usage extraction"],
			facts: [],
		},
		{
			id: 8,
			claim:
				"Claude Code `is_error` is missing on about 15% of tool results, so missing should mean unknown.",
			localData:
				"Missing on 19% (5,519 results), mostly Read, Edit, Write and WebFetch; only 4 of them look like errors.",
			opaline:
				"L1 stores a missing flag as false (succeeded): almost always right, but an inference, not a literal value.",
			action:
				"Catalog note on Claude Code `is_error` (done); no parser change.",
			kinds: ["none"],
			facts: ["calls/is_error"],
		},
		{
			id: 9,
			claim: "Codex failure is a non-zero exit code read from the output text.",
			localData:
				"Too simple: the audit found refusals, `write_stdin` failures, unparsable arguments, stopped calls, and 4,324 late exit codes that never reach their call.",
			opaline:
				"Already the catalog's wrong rows for Codex `is_error` and `exit_code`, fixed in parser 9.",
			action: "None beyond parser 9.",
			kinds: ["parser 9"],
			facts: ["calls/is_error", "calls/exit_code"],
		},
		{
			id: 10,
			claim: "Interrupted is a Claude Code tool call with no result.",
			opaline:
				"That is an inference; Claude Code writes `toolUseResult.interrupted` literally, stored since parser 6.",
			action: "None (keep the literal value).",
			kinds: ["none"],
			facts: ["calls/interrupted"],
		},
		{
			id: 11,
			claim:
				"Cost: always estimate Codex cost (its logs carry none), label each cost reported or estimated, and show API-equivalent USD with a billing basis (subscription dollars are not real spend). Apply the service-tier multiplier for fast or priority.",
			opaline:
				"Unverified whether costs carry a reported/estimated label and a billing basis. Codex only logs the thread's configured tier, so a tier multiplier can only use that; this informs open decision 3 (`service_tier`).",
			action: "Check cost labelling; decide decision 3.",
			kinds: ["check", "decision"],
			facts: ["runs/service_tier", "runs/cost_usd"],
		},
		{
			id: 12,
			claim:
				"Tool categories (read, search, edit, execute, test, plan, delegate, web, mcp, interact), with Codex `exec_command` classified by its first word.",
			opaline: "`command-class.ts` already classifies shell commands.",
			action: "None; compare the category list when building analysis.",
			kinds: ["none"],
			facts: [],
		},
		{
			id: 13,
			claim:
				"Export formats: ATIF as a later export, not the internal format (no tool error status, no turns, no timings); OpenTelemetry GenAI conventions for naming only (unstable, live telemetry).",
			action: "None now.",
			kinds: ["none"],
			facts: [],
		},
		{
			id: 14,
			claim:
				"Codex `history_mode` paginated vs legacy: do not count a call twice from `response_item` and `item_completed`.",
			opaline:
				"`codex-completed-items` merges completion items into the call by `call_id`.",
			action: "None.",
			kinds: ["none"],
			facts: [],
		},
	],
	thinner:
		"It has no permission decisions, skills, MCP servers, per-call working directory or denial reasons, and it infers facts the logs state literally. The literal layer plus the census is what sets Opaline apart.",
	referencesNote:
		"Code worth comparing against the catalog (a census-style check, not new design).",
	references: [
		{
			name: "SpecStory",
			files: [
				"specstory-cli/docs/SPI-SESSION-DATA-SCHEMA.md",
				"pkg/providers/codexcli/agent_session.go",
			],
		},
		{
			name: "tokscale",
			files: [
				"crates/tokscale-core/src/sessions/mod.rs",
				"crates/tokscale-core/src/sessions/codex.rs",
			],
			note: "dedup keys, reported/estimated cost",
		},
		{
			name: "ccusage, Codex adapter notes",
			files: ["rust/adapters/codex/src/README.md"],
			note: "Codex quirks",
		},
		{ name: "claude-code-log", files: ["codex_tools.py"] },
		{ name: "Agent Sessions (macOS)", files: ["SessionEvent.swift"] },
	],
};
