import { describe, expect, test } from "bun:test";
import {
	claudeInstructionFacts,
	claudeSystemFacts,
	codexDenialKind,
	codexDenialReason,
	factText,
	mergeFacts,
} from "./record-facts.js";
import { splitSessionTranscript } from "./split-transcript.js";
import {
	NO_TRANSCRIPT_RECORD_FACTS,
	TRANSCRIPT_RECORD_FACT_KEYS,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptRecordDraft,
	type TranscriptRecordFacts,
	type TranscriptSource,
} from "./types.js";

/**
 * The literal facts of docs/l1-literal-schema.md (step 7), one fixture case
 * per fact, from real Claude Code 2.1.29x and Codex 0.156 lines with values
 * replaced. The spec checks below fail when a raw or text fact in the spec is
 * neither stored nor listed as pending, or when a stored fact loses its case.
 */

const FIXTURES = {
	claude: "l1-facts/claude-2.1.jsonl",
	codex: "l1-facts/codex-0.156.jsonl",
} as const;
const IDENTITY_FIXTURES = [
	"claude-subagent-turns.jsonl",
	"codex-custom-exec-era.jsonl",
	"codex-direct-era.jsonl",
	"codex-end-event-era.jsonl",
	"codex-subagent-turns.jsonl",
	FIXTURES.claude,
	FIXTURES.codex,
] as const;

type TypedFact = Exclude<keyof TranscriptRecordFacts, "extra">;
type FactField = TypedFact | keyof typeof TRANSCRIPT_RECORD_FACT_KEYS;

const drafts = new Map<string, TranscriptRecordDraft[]>();

async function split(name: string): Promise<TranscriptRecordDraft[]> {
	const cached = drafts.get(name);
	if (cached !== undefined) return cached;
	const content = await Bun.file(
		new URL(`../__fixtures__/${name}`, import.meta.url),
	).text();
	const source: TranscriptSource = name.includes("claude")
		? "claude_code"
		: "codex";
	const rows = [
		...splitSessionTranscript({
			content,
			sessionDate: "2026-10-01T09:00:00.000Z",
			source,
		}),
	];
	drafts.set(name, rows);
	return rows;
}

interface FactCase {
	readonly name: string;
	readonly fixture: keyof typeof FIXTURES;
	readonly row: {
		/** Text the row's head contains. */
		readonly text?: string;
		/** Which of several matching rows, from 0. */
		readonly nth?: number;
		readonly callId?: string;
		readonly kind: string;
		readonly subtype?: string;
	};
	readonly facts: Partial<Omit<TranscriptRecordFacts, "extra">> & {
		readonly extra?: Partial<
			Record<keyof typeof TRANSCRIPT_RECORD_FACT_KEYS, string>
		>;
	};
}

const CASES: readonly FactCase[] = [
	{
		name: "Claude version and entrypoint on every record",
		fixture: "claude",
		row: { kind: "user_prompt" },
		facts: { agentVersion: "2.1.292", entrypoint: "sdk-ts" },
	},
	{
		name: "Codex cli_version and originator on every record",
		fixture: "codex",
		row: { callId: "call_cmd", kind: "tool_call" },
		facts: { agentVersion: "0.156.0", entrypoint: "codex_exec" },
	},
	{
		name: "skill attribution on the records of its line",
		fixture: "claude",
		row: { callId: "toolu_push", kind: "tool_call" },
		facts: { attributionSkill: "ship-it" },
	},
	{
		name: "push and its branch",
		fixture: "claude",
		row: { callId: "toolu_push", kind: "tool_result" },
		facts: {
			gitOperation: ["commit", "push"],
			interrupted: false,
			extra: {
				"git.commit.kind": "committed",
				"git.commit.sha": "4f2a9c1",
				"git.push.branch": "fix/login",
				no_output_expected: "false",
				stderr_chars: "0",
				stdout_chars: "54",
			},
		},
	},
	{
		name: "several git operations, URL credentials stripped",
		fixture: "claude",
		row: { callId: "toolu_pr", kind: "tool_result" },
		facts: {
			gitOperation: ["branch", "pr"],
			extra: {
				"git.branch.action": "rebased",
				"git.branch.ref": "origin/main",
				"git.pr.action": "created",
				"git.pr.number": "42",
				"git.pr.url": "https://github.com/acme/app/pull/42",
			},
		},
	},
	{
		name: "pr-link record",
		fixture: "claude",
		row: { kind: "meta", subtype: "pr-link" },
		facts: {
			extra: {
				pr_number: "42",
				pr_repository: "acme/app",
				pr_url: "https://github.com/acme/app/pull/42",
			},
		},
	},
	{
		name: "Claude MCP attribution on the call",
		fixture: "claude",
		row: { callId: "toolu_mcp", kind: "tool_call" },
		facts: { mcpServer: "posthog", mcpTool: "exec" },
	},
	{
		name: "Claude MCP attribution repeated on the result",
		fixture: "claude",
		row: { callId: "toolu_mcp", kind: "tool_result" },
		facts: { mcpServer: "posthog", mcpTool: "exec" },
	},
	{
		name: "return code interpretation, stale read and shell edits",
		fixture: "claude",
		row: { callId: "toolu_sed", kind: "tool_result" },
		facts: {
			extra: {
				return_code_interpretation: "No matches found",
				shell_edit_files: JSON.stringify([
					{ filePath: "/repo/src/a.ts" },
					{ filePath: "/repo/src/new.ts", created: true },
					{ filePath: "/repo/src/old.ts", deleted: true },
				]),
				shell_edit_files_more: "2",
				shell_edit_changed_files: JSON.stringify([
					"/repo/src/a.ts",
					"/repo/src/new.ts",
					"/repo/src/old.ts",
					"/repo/src/lock.json",
				]),
				stale_read:
					"[This command modified 1 file you've previously read: src/a.ts. Call Read before editing.]",
			},
		},
	},
	{
		name: "an unavailable shell diff keeps its empty list and zero count",
		fixture: "claude",
		row: { callId: "toolu_shared", kind: "tool_result" },
		facts: {
			extra: {
				shell_edit_files: "[]",
				shell_edit_files_more: "0",
				shell_edit_unavailable: "true",
			},
		},
	},
	{
		name: "a long changedFiles list is cut to whole paths and counted",
		fixture: "claude",
		row: { callId: "toolu_codegen", kind: "tool_result" },
		facts: {
			extra: {
				shell_edit_changed_files_more: "27",
				shell_edit_files: "[]",
				shell_edit_files_more: "60",
				shell_edit_shared: "true",
			},
		},
	},
	{
		name: "background task and its timeout",
		fixture: "claude",
		row: { callId: "toolu_bg", kind: "tool_result" },
		facts: { timedOutAfterMs: 600_000, extra: { background_task_id: "bg1" } },
	},
	{
		name: "timeout of a wait",
		fixture: "claude",
		row: { callId: "toolu_wait", kind: "tool_result" },
		facts: { extra: { timeout_ms: "1200000" } },
	},
	{
		name: "Claude durationMs",
		fixture: "claude",
		row: { callId: "toolu_fetch", kind: "tool_result" },
		facts: { durationMs: 4943 },
	},
	{
		name: "Claude durationSeconds in milliseconds",
		fixture: "claude",
		row: { callId: "toolu_search", kind: "tool_result" },
		facts: { durationMs: 5891 },
	},
	{
		name: "async agent launch",
		fixture: "claude",
		row: { callId: "toolu_agent", kind: "tool_result" },
		facts: { extra: { is_async: "true" } },
	},
	{
		name: "search matches",
		fixture: "claude",
		row: { callId: "toolu_grep", kind: "tool_result" },
		facts: { extra: { search_matches: "3" } },
	},
	{
		name: "patch line counts and user edits",
		fixture: "claude",
		row: { callId: "toolu_edit", kind: "tool_result" },
		facts: {
			extra: {
				patch_lines_added: "2",
				patch_lines_removed: "1",
				user_modified: "false",
			},
		},
	},
	{
		name: "persisted output size",
		fixture: "claude",
		row: { callId: "toolu_big", kind: "tool_result" },
		facts: { extra: { persisted_output_bytes: "32229" } },
	},
	{
		name: "interrupted call",
		fixture: "claude",
		row: { callId: "toolu_ctrlc", kind: "tool_result" },
		facts: { interrupted: true, extra: { no_output_expected: "true" } },
	},
	{
		name: "denied call",
		fixture: "claude",
		row: { callId: "toolu_rm", kind: "tool_result" },
		facts: { denialKind: "permission-rule", interrupted: null, extra: {} },
	},
	{
		name: "secrets in a value are redacted",
		fixture: "claude",
		row: { callId: "toolu_token", kind: "tool_result" },
		facts: {
			extra: { return_code_interpretation: "token [redacted]" },
		},
	},
	{
		name: "Codex call duration on its completion row",
		fixture: "codex",
		row: {
			callId: "call_cmd",
			kind: "meta",
			subtype: "item_completed:CommandExecution_mirror",
		},
		facts: { durationMs: 1250 },
	},
	{
		name: "a Codex completion after a running output keeps its duration",
		fixture: "codex",
		row: {
			callId: "call_late",
			kind: "meta",
			subtype: "item_completed:CommandExecution_mirror",
		},
		facts: { durationMs: 95_500 },
	},
	{
		name: "Codex MCP identity, read-only hint and plugin on the completion row",
		fixture: "codex",
		row: {
			callId: "call_mcp",
			kind: "meta",
			subtype: "item_completed:McpToolCall_mirror",
		},
		facts: {
			durationMs: 876,
			mcpServer: "posthog",
			mcpTool: "exec",
			extra: { attribution_plugin: "posthog@1.2.0", mcp_read_only: "true" },
		},
	},
	{
		name: "Codex exec_command_end duration",
		fixture: "codex",
		row: { callId: "call_old", kind: "meta", subtype: "exec_command_end" },
		facts: { durationMs: 2000 },
	},
	{
		name: "Codex nested command duration",
		fixture: "codex",
		row: { callId: "nested_cmd", kind: "tool_result" },
		facts: { durationMs: 40 },
	},
	{
		name: "Codex nested MCP call",
		fixture: "codex",
		row: { callId: "nested_mcp", kind: "tool_call" },
		facts: { mcpServer: "node_repl", mcpTool: "js" },
	},
	{
		name: "Claude permission mode on the prompt; a recorded false shutdown",
		fixture: "claude",
		row: { kind: "user_prompt", text: "plan the migration first" },
		facts: { extra: { aborted: "false", permission_mode: "plan" } },
	},
	{
		name: "Claude auto mode flags",
		fixture: "claude",
		row: { kind: "meta", subtype: "attachment:auto_mode" },
		facts: {
			extra: {
				auto_mode_bash_first: "true",
				auto_mode_bash_first_steer: "relaxed",
				auto_mode_bypass: "true",
				auto_mode_consent_flow: "false",
				auto_mode_steer_only: "true",
			},
		},
	},
	{
		name: "Claude model, effort and stop reason on an assistant line",
		fixture: "claude",
		row: { kind: "assistant_text", text: "Here is the plan." },
		facts: {
			extra: {
				effort: "xhigh",
				model: "claude-opus-5-5",
				per_turn_effort: "high",
				stop_reason: "end_turn",
			},
		},
	},
	{
		name: "Claude API error message",
		fixture: "claude",
		row: { kind: "meta", subtype: "api_error_message" },
		facts: {
			extra: {
				api_error: "rate_limit",
				api_error_status: "429",
				model: "claude-opus-5-5",
			},
		},
	},
	{
		name: "Claude API retry",
		fixture: "claude",
		row: { kind: "meta", subtype: "system:api_error" },
		facts: {
			extra: { max_retries: "10", retry_attempt: "1", retry_in_ms: "556" },
		},
	},
	{
		name: "Claude model refusal and fallback",
		fixture: "claude",
		row: { kind: "meta", subtype: "system:model_refusal_fallback" },
		facts: {
			extra: {
				fallback_model: "claude-opus-4-8",
				original_model: "claude-opus-5-5[1m]",
				refusal_category: "cyber",
			},
		},
	},
	{
		name: "Claude stop hook summary",
		fixture: "claude",
		row: { kind: "meta", subtype: "system:stop_hook_summary:prevented" },
		facts: {
			extra: {
				hook_count: "2",
				hook_errors: JSON.stringify(["lint failed: 2 errors"]),
				hook_runs: JSON.stringify([
					{
						command: "/usr/local/bin/agent-finished claude-code",
						durationMs: 132,
					},
					{ command: "bun run lint", durationMs: 4210 },
				]),
				hook_stop_reason: "Fix lint before stopping",
				prevented_continuation: "true",
			},
		},
	},
	{
		name: "Claude compaction metadata",
		fixture: "claude",
		row: { kind: "compaction", subtype: "compact_boundary" },
		facts: { extra: { compact_pre_tokens: "167432", compact_trigger: "auto" } },
	},
	{
		name: "Claude prompt after a shutdown",
		fixture: "claude",
		row: { kind: "user_prompt", text: "continue where you left off" },
		facts: { extra: { aborted: "true" } },
	},
	{
		name: "Codex turn context",
		fixture: "codex",
		row: { kind: "meta", subtype: "turn_context" },
		facts: {
			extra: {
				approval_policy: "on-request",
				approvals_reviewer: "auto_review",
				collaboration_mode: "default",
				turn_id: "t2",
				effort: "high",
				model: "gpt-6.1-sol",
				permission_profile: "managed",
				sandbox_network_access: "false",
				sandbox_policy: "workspace-write",
			},
		},
	},
	{
		name: "Codex task start",
		fixture: "codex",
		row: { kind: "meta", subtype: "task_started" },
		facts: { extra: { context_window: "258400" } },
	},
	{
		name: "Codex task completion",
		fixture: "codex",
		row: { kind: "meta", subtype: "task_complete" },
		facts: {
			durationMs: 2272,
			extra: { time_to_first_token_ms: "1941", turn_id: "t2" },
		},
	},
	{
		name: "Codex failed task",
		fixture: "codex",
		row: { kind: "meta", subtype: "task_complete", nth: 1 },
		facts: {
			durationMs: 496_218,
			extra: {
				turn_error:
					"Selected model is at capacity. Please try a different model.",
				turn_error_kind: "server_overloaded",
			},
		},
	},
	{
		name: "Codex aborted turn",
		fixture: "codex",
		row: { kind: "meta", subtype: "turn_aborted" },
		facts: {
			durationMs: 2614,
			extra: { abort_reason: "interrupted", aborted: "true", turn_id: "t4" },
		},
	},
	{
		name: "Codex goal",
		fixture: "codex",
		row: { kind: "meta", subtype: "thread_goal_updated" },
		facts: {
			extra: {
				facts_clipped: "goal",
				goal_status: "active",
				goal_time_used_seconds: "22",
				goal_tokens_used: "1200",
			},
		},
	},
	{
		name: "Codex sub-agent thread",
		fixture: "codex",
		row: { kind: "meta", subtype: "item_completed:SubAgentActivity" },
		facts: {
			extra: {
				spawned_thread_ids: JSON.stringify([
					"01a10b68-012e-7a60-b141-5c0ccce6bc01",
				]),
			},
		},
	},
	{
		name: "Codex error variant with a payload",
		fixture: "codex",
		row: { kind: "meta", subtype: "task_complete", nth: 2 },
		facts: {
			extra: {
				turn_error: "unexpected status 401 Unauthorized",
				turn_error_info: JSON.stringify({
					http_connection_failed: { http_status_code: 401 },
				}),
				turn_error_kind: "http_connection_failed",
				turn_id: "t5",
			},
		},
	},
	{
		name: "a long thread list is cut to whole entries and counted",
		fixture: "codex",
		row: {
			kind: "meta",
			subtype: "item_completed:CollabAgentToolCall",
			nth: 1,
		},
		facts: { extra: { spawned_thread_ids_more: "8" } },
	},
	{
		name: "long hook lists are cut and counted; long entries are marked clipped",
		fixture: "claude",
		row: { kind: "meta", subtype: "system:stop_hook_summary", nth: 0 },
		facts: {
			extra: {
				facts_clipped: "hook_runs",
				hook_errors_more: "4",
				hook_runs_more: "3",
				hook_stop_reason: "",
				prevented_continuation: "false",
			},
		},
	},
	{
		name: "Claude prompt origin, as recorded",
		fixture: "claude",
		row: { kind: "injected_context", text: "build finished" },
		facts: {
			extra: {
				origin_kind: "task-notification",
				prompt_source: "system",
				turn_origin: "task_notification",
			},
		},
	},
	{
		name: "Claude instruction files",
		fixture: "claude",
		row: { kind: "injected_context", subtype: "instructions", nth: 0 },
		facts: {
			extra: {
				instruction_paths: JSON.stringify([
					{ path: "/home/dev/.claude/CLAUDE.md", type: "User" },
					{ path: "/repo/CLAUDE.md", type: "Project" },
				]),
			},
		},
	},
	{
		name: "a long instruction list is cut to whole files and counted",
		fixture: "claude",
		row: { kind: "injected_context", subtype: "instructions", nth: 1 },
		facts: { extra: { instruction_paths_more: "53" } },
	},
	{
		name: "Claude cost state",
		fixture: "claude",
		row: { kind: "meta", subtype: "cost-state" },
		facts: {
			durationMs: 3_701_131,
			extra: {
				api_duration_ms: "85113",
				api_duration_without_retries_ms: "85088",
				cost_usd: "0.2787572",
				has_unknown_model_cost: "false",
				lines_added: "12",
				lines_removed: "3",
				tool_duration_ms: "2202",
			},
		},
	},
	{
		name: "Claude title",
		fixture: "claude",
		row: { kind: "meta", subtype: "ai-title", text: "Ship the login fix" },
		facts: { extra: { title: "Ship the login fix" } },
	},
	{
		name: "Codex thread source",
		fixture: "codex",
		row: { kind: "meta", subtype: "session_meta" },
		facts: { extra: { thread_source: "user" } },
	},
	{
		name: "Codex inter-agent trigger",
		fixture: "codex",
		row: { kind: "meta", subtype: "inter_agent_communication_metadata" },
		facts: { extra: { trigger_turn: "true" } },
	},
	{
		name: "Claude Skill invocation on its call",
		fixture: "claude",
		row: { callId: "toolu_skill", kind: "tool_call" },
		facts: { extra: { skill: "pr-creation" } },
	},
	{
		name: "Codex call timeout limit from its arguments",
		fixture: "codex",
		row: { callId: "call_stopped", kind: "tool_call" },
		facts: { extra: { timeout_ms: "20000" } },
	},
	{
		name: "Codex call the user stopped, with its duration",
		fixture: "codex",
		row: { callId: "call_stopped", kind: "tool_result" },
		facts: { durationMs: 342_200, interrupted: true },
	},
	{
		name: "Codex sandbox denial, as Codex names it",
		fixture: "codex",
		row: { callId: "call_sandboxed", kind: "tool_result" },
		facts: { denialKind: "Sandbox(Denied)" },
	},
	{
		name: "Codex rejected approval, as Codex names it",
		fixture: "codex",
		row: { callId: "call_rejected", kind: "tool_result" },
		facts: {
			denialKind: "Rejected",
			extra: { denial_reason: "rejected by user" },
		},
	},
	{
		name: "Codex parsed command parts and read paths (a skill read)",
		fixture: "codex",
		row: {
			callId: "call_cmd",
			kind: "meta",
			subtype: "item_completed:CommandExecution_mirror",
		},
		facts: {
			extra: {
				parsed_cmd_read_paths: JSON.stringify([
					".claude/skills/testing-bun/SKILL.md",
				]),
				parsed_cmd_types: JSON.stringify(["read", "unknown"]),
			},
		},
	},
	{
		name: "a long read path list is cut to whole paths and counted",
		fixture: "codex",
		row: { callId: "nested_reads", kind: "tool_result" },
		facts: { extra: { parsed_cmd_read_paths_more: "8" } },
	},
];

function findRow(
	rows: readonly TranscriptRecordDraft[],
	row: FactCase["row"],
): TranscriptRecordDraft {
	const match = rows.filter(
		(draft) =>
			draft.kind === row.kind &&
			(row.callId === undefined || draft.callId === row.callId) &&
			(row.subtype === undefined || draft.subtype === row.subtype) &&
			(row.text === undefined || draft.head.includes(row.text)),
	)[row.nth ?? 0];
	if (match === undefined) throw new Error(`No row ${JSON.stringify(row)}`);
	return match;
}

describe("parser facts", () => {
	test.each(
		CASES.map((item) => [item.name, item] as const),
	)("%s", async (_name, item) => {
		const draft = findRow(await split(FIXTURES[item.fixture]), item.row);
		const { extra, ...typed } = item.facts;
		expect(draft.facts).toMatchObject(typed);
		if (extra !== undefined) {
			if (Object.keys(extra).length === 0)
				expect(draft.facts.extra).toEqual({});
			else expect(draft.facts.extra).toMatchObject(extra);
		}
	});

	test("Codex outputs carry no completion facts: each fact lands once", async () => {
		// A stopped call's own output says how long it ran; that is its fact.
		const outputs = (await split(FIXTURES.codex)).filter(
			(draft) =>
				draft.kind === "tool_result" &&
				draft.subtype !== "nested" &&
				draft.callId !== "call_stopped",
		);
		expect(outputs.length).toBeGreaterThan(0);
		for (const output of outputs) {
			expect(output.facts.durationMs).toBeNull();
			expect(output.facts.mcpServer).toBe("");
		}
	});

	test("past the session fact budget, long values are dropped and the record says so", async () => {
		const content = await Bun.file(
			new URL(`../__fixtures__/${FIXTURES.claude}`, import.meta.url),
		).text();
		const rows = [
			...splitSessionTranscript({
				content,
				factBudgetChars: 0,
				sessionDate: "2026-10-01T09:00:00.000Z",
				source: "claude_code",
			}),
		];
		const sed = findRow(rows, { callId: "toolu_sed", kind: "tool_result" });
		expect(sed.facts.extra).toEqual({
			facts_truncated: "true",
			no_output_expected: "false",
			return_code_interpretation: "No matches found",
			shell_edit_files_more: "2",
			stderr_chars: "0",
			stdout_chars: "0",
		});
		// Typed facts are short and always kept.
		const pr = findRow(rows, { callId: "toolu_pr", kind: "tool_result" });
		expect(pr.facts.gitOperation).toEqual(["branch", "pr"]);
		expect(pr.facts.extra.facts_truncated).toBe("true");
		// Only short values to begin with: nothing dropped, nothing marked.
		const wait = findRow(rows, { callId: "toolu_wait", kind: "tool_result" });
		expect(wait.facts.extra).toEqual({ timeout_ms: "1200000" });
		// Records with no facts map are untouched.
		const prompt = findRow(rows, { kind: "user_prompt" });
		expect(prompt.facts.extra).toEqual({});
	});

	test("fact text loses URL credentials, known secrets and generic credentials", () => {
		expect(
			[
				"https://bot:p@ss@github.com/acme/app/pull/42",
				"INTERNAL_API_KEY=sk_live_abcdefghijklmnop1234 bun run deploy",
				"curl --token abcdef123456789xyz https://example.com",
				"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def",
				"No matches found",
			].map((value) => factText(value)),
		).toEqual([
			"https://github.com/acme/app/pull/42",
			"INTERNAL_API_KEY=[redacted] bun run deploy",
			"curl --token [redacted] https://example.com",
			"Authorization: Bearer [redacted]",
			"No matches found",
		]);
	});

	test("a failed Codex task is an error row with its message; a goal keeps its full text", async () => {
		const rows = await split(FIXTURES.codex);
		const failed = findRow(rows, {
			kind: "meta",
			subtype: "task_complete",
			nth: 1,
		});
		expect(failed.isError).toBe(true);
		expect(failed.text).toBe(
			"Selected model is at capacity. Please try a different model.",
		);
		const goal = findRow(rows, {
			kind: "meta",
			subtype: "thread_goal_updated",
		});
		expect(goal.textChars).toBeGreaterThan(512);
		expect(goal.text.startsWith("ship parser v7 with every run fact.")).toBe(
			true,
		);
		expect(goal.facts.extra.goal?.length).toBe(512);
	});

	test("row text lifted from a field is redacted, and merged facts keep every clipped key", () => {
		const content = [
			JSON.stringify({
				type: "event_msg",
				timestamp: "2026-10-01T10:00:00.000Z",
				payload: {
					type: "task_complete",
					turn_id: "t9",
					error: {
						message:
							"deploy failed: INTERNAL_API_KEY=sk_live_abcdefghijklmnop1234",
					},
				},
			}),
			JSON.stringify({
				type: "event_msg",
				timestamp: "2026-10-01T10:00:01.000Z",
				payload: {
					type: "thread_goal_updated",
					goal: {
						objective: "run curl --token abcdef123456789xyz against staging",
					},
				},
			}),
		].join("\n");
		const rows = [
			...splitSessionTranscript({
				content,
				sessionDate: "2026-10-01T10:00:00.000Z",
				source: "codex",
			}),
		];
		expect(rows.map((row) => row.text)).toEqual([
			"deploy failed: INTERNAL_API_KEY=[redacted]",
			"run curl --token [redacted] against staging",
		]);
		expect(
			mergeFacts(
				{ extra: { facts_clipped: "turn_error" } },
				{ extra: { facts_clipped: "model,goal" } },
			).extra?.facts_clipped,
		).toBe("goal,model,turn_error");
	});

	test("a title's row text is redacted, and a clipped instruction type is marked", () => {
		const [title] = [
			...splitSessionTranscript({
				content: JSON.stringify({
					type: "ai-title",
					aiTitle: "Rotate TOKEN=abcdef123456789xyz on staging",
				}),
				sessionDate: "2026-10-01T10:00:00.000Z",
				source: "claude_code",
			}),
		];
		expect(title?.text).toBe("Rotate TOKEN=[redacted] on staging");
		expect(
			claudeInstructionFacts({
				files: [{ path: "/repo/CLAUDE.md", type: "T".repeat(80) }],
			}).extra?.facts_clipped,
		).toBe("instruction_paths");
	});

	test("a list whose JSON exactly fits the cap keeps every entry", () => {
		// 2 brackets + 3 commas + 4 × `{"command":""}` (14) + 1,987 characters = 2,048.
		const commands = [497, 497, 497, 496].map((length) => "x".repeat(length));
		const facts = claudeSystemFacts({
			subtype: "stop_hook_summary",
			hookInfos: commands.map((command) => ({ command })),
		});
		expect(facts.extra?.hook_runs?.length).toBe(2_048);
		expect(facts.extra?.hook_runs_more).toBeUndefined();
	});

	test("a Codex denial is found after a quoted command of any length, and only in Codex's envelope", () => {
		const long = "x".repeat(10_000);
		expect(
			codexDenialKind(
				`exec_command failed for \`/bin/zsh -lc '${long}'\`: CreateProcess { message: "Rejected(\\"rejected by user\\")" }`,
			),
		).toBe("Rejected");
		expect(
			codexDenialKind(
				'exec_command failed: CreateProcess { message: "Codex(Sandbox(Denied { output: … }))" }',
			),
		).toBe("Sandbox(Denied)");
		// Command output that merely mentions the words is not a denial.
		expect(
			codexDenialKind(
				'Output:\nexec_command failed: CreateProcess { message: "Rejected(\\"x\\")" }',
			),
		).toBeUndefined();
		expect(codexDenialKind("exec_command failed: exit code 1")).toBeUndefined();
		// The reason is a debug string inside a debug string: both layers unescaped.
		expect(
			codexDenialReason(
				'exec_command failed: CreateProcess { message: "Rejected(\\"`/bin/zsh -lc \\\\\\"rm -rf /tmp/x\\\\\\"` rejected: blocked by policy\\")" }',
			),
		).toBe('`/bin/zsh -lc "rm -rf /tmp/x"` rejected: blocked by policy');
	});

	test("a prompt's facts stay off the tool result on the same line", async () => {
		const rows = await split(FIXTURES.claude);
		const prompt = findRow(rows, {
			kind: "user_prompt",
			text: "also check the tests",
		});
		const result = findRow(rows, {
			kind: "tool_result",
			callId: "toolu_mixed",
		});
		expect(prompt.facts.extra.permission_mode).toBe("default");
		expect(result.facts.extra.permission_mode).toBeUndefined();
		expect(result.facts.extra.stdout_chars).toBe("4");
	});

	test("rows that carry nothing keep the not-recorded defaults", async () => {
		const rows = await split(FIXTURES.claude);
		const call = findRow(rows, { callId: "toolu_pr", kind: "tool_call" });
		expect(call.facts).toEqual({
			...NO_TRANSCRIPT_RECORD_FACTS,
			agentVersion: "2.1.292",
			entrypoint: "sdk-ts",
		});
	});

	test("the version follows the latest record that names one", async () => {
		const prompts = (await split(FIXTURES.claude)).filter(
			(draft) => draft.kind === "user_prompt",
		);
		expect(prompts.map((draft) => draft.facts.agentVersion)).toEqual([
			...prompts.slice(0, -1).map(() => "2.1.292"),
			"2.1.293",
		]);
	});

	test("a Codex sub-agent in the file inherits the file's version", async () => {
		const worker = (await split(FIXTURES.codex)).find(
			(draft) => draft.agentId === "/root/worker",
		);
		expect(worker?.facts.agentVersion).toBe("0.156.0");
		expect(worker?.facts.entrypoint).toBe("codex_exec");
	});

	test("every emitted key is registered and every registered key has a case", async () => {
		const registered = new Set(Object.keys(TRANSCRIPT_RECORD_FACT_KEYS));
		for (const name of Object.values(FIXTURES)) {
			for (const draft of await split(name)) {
				for (const key of Object.keys(draft.facts.extra))
					expect(registered).toContain(key);
			}
		}
		const covered = new Set([
			// Checked by the fact budget and goal text tests above.
			"facts_truncated",
			"goal",
			...CASES.flatMap((item) => [
				...Object.keys(item.facts),
				...Object.keys(item.facts.extra ?? {}),
			]),
		]);
		const typed = Object.keys(NO_TRANSCRIPT_RECORD_FACTS).filter(
			(key) => key !== "extra",
		);
		for (const key of [...typed, ...registered]) expect(covered).toContain(key);
		for (const since of Object.values(TRANSCRIPT_RECORD_FACT_KEYS))
			expect(since).toBeLessThanOrEqual(TRANSCRIPT_RECORDS_PARSER_VERSION);
	});

	test("record identities match parser v5, so run ids and edges stay stable", async () => {
		const expected = (await Bun.file(
			new URL(
				"../__fixtures__/l1-facts/record-identities.v5.json",
				import.meta.url,
			),
		).json()) as Record<string, string[]>;
		for (const name of IDENTITY_FIXTURES) {
			const identities = (await split(name)).map((draft) =>
				[
					draft.agentId,
					draft.recordIdx,
					draft.blockIdx,
					draft.turnIdx,
					draft.kind,
					draft.subtype,
				].join("|"),
			);
			expect(identities).toEqual(expected[name] ?? []);
		}
	});
});

/**
 * Spec facts the parser stores, by `<view>.<column>`, with the fact fields
 * that carry each. Every field needs a case above.
 */
const STORED: Readonly<Record<string, readonly FactField[]>> = {
	"calls.denial_kind": ["denialKind"],
	"calls.return_code_interpretation": ["return_code_interpretation"],
	"calls.duration_ms": ["durationMs"],
	"calls.timed_out_after_ms": ["timedOutAfterMs"],
	"calls.timeout_ms": ["timeout_ms"],
	"calls.is_async": ["is_async"],
	"calls.background_task_id": ["background_task_id"],
	"calls.interrupted": ["interrupted"],
	"calls.no_output_expected": ["no_output_expected"],
	"calls.stdout_chars": ["stdout_chars"],
	"calls.stderr_chars": ["stderr_chars"],
	"calls.persisted_output_bytes": ["persisted_output_bytes"],
	"calls.shell_edit_files": [
		"shell_edit_files",
		"shell_edit_files_more",
		"shell_edit_changed_files",
		"shell_edit_changed_files_more",
		"shell_edit_unavailable",
		"shell_edit_shared",
	],
	"calls.git_operation": [
		"gitOperation",
		"git.push.branch",
		"git.pr.number",
		"git.pr.action",
		"git.pr.url",
		"git.commit.sha",
		"git.commit.kind",
		"git.branch.ref",
		"git.branch.action",
	],
	"calls.mcp_server": ["mcpServer"],
	"calls.mcp_tool": ["mcpTool"],
	"calls.mcp_read_only": ["mcp_read_only"],
	"calls.patch_lines_added": ["patch_lines_added"],
	"calls.patch_lines_removed": ["patch_lines_removed"],
	"calls.user_modified": ["user_modified"],
	"calls.stale_read": ["stale_read"],
	"calls.search_matches": ["search_matches"],
	"calls.attribution_skill": ["attributionSkill"],
	"calls.attribution_plugin": ["attribution_plugin"],
	"calls.spawned_agent_id": ["spawned_thread_ids"],
	"runs.duration_ms": ["durationMs"],
	"runs.time_to_first_token_ms": ["time_to_first_token_ms"],
	"runs.permission_mode": ["permission_mode"],
	"runs.auto_mode_*": [
		"auto_mode_bash_first",
		"auto_mode_bash_first_steer",
		"auto_mode_bypass",
		"auto_mode_steer_only",
		"auto_mode_consent_flow",
	],
	"runs.approval_policy": ["approval_policy"],
	"runs.approvals_reviewer": ["approvals_reviewer"],
	"runs.sandbox_policy": ["sandbox_policy", "sandbox_network_access"],
	"runs.permission_profile": ["permission_profile", "collaboration_mode"],
	"runs.model": ["model"],
	"runs.effort": ["effort", "per_turn_effort"],
	"runs.context_window": ["context_window"],
	"runs.compact_trigger": ["compact_trigger"],
	"runs.compact_pre_tokens": ["compact_pre_tokens"],
	"runs.aborted": ["aborted"],
	"runs.abort_reason": ["abort_reason"],
	"runs.turn_error": ["turn_error", "turn_error_kind"],
	"runs.stop_reason": ["stop_reason"],
	"runs.hook_stop_reason": ["hook_stop_reason"],
	"runs.hook_errors": ["hook_errors", "hook_count"],
	"runs.prevented_continuation": ["prevented_continuation"],
	"runs.hook_runs": ["hook_runs"],
	"runs.api_errors": ["api_error", "api_error_status"],
	"runs.retry_attempts": ["retry_attempt", "max_retries", "retry_in_ms"],
	"runs.refusals": ["refusal_category", "original_model"],
	"runs.fallback_model": ["fallback_model"],
	"runs.goal": [
		"goal",
		"goal_status",
		"goal_tokens_used",
		"goal_time_used_seconds",
	],
	"runs.prompt_origin": [
		"turn_origin",
		"prompt_source",
		"origin_kind",
		"trigger_turn",
		"thread_source",
	],
	"prompts.prompt_origin": [
		"turn_origin",
		"prompt_source",
		"origin_kind",
		"trigger_turn",
		"thread_source",
	],
	"prompts.instruction_path": ["instruction_paths", "instruction_paths_more"],
	"session.cost_state": [
		"cost_usd",
		"lines_added",
		"lines_removed",
		"tool_duration_ms",
		"api_duration_ms",
		"api_duration_without_retries_ms",
		"has_unknown_model_cost",
	],
	"session.title": ["title"],
	"calls.skill": ["skill"],
	"calls.parsed_cmd_types": ["parsed_cmd_types"],
	"calls.denial_reason": ["denial_reason"],
	"calls.parsed_cmd_read_paths": [
		"parsed_cmd_read_paths",
		"parsed_cmd_read_paths_more",
	],
	"runs.entrypoint": ["entrypoint"],
	"runs.agent_version": ["agentVersion"],
	"runs.pr_repository": ["pr_repository"],
	"runs.pr_number": ["pr_number", "pr_url"],
};

/** Facts whose typed column predates them: the run duration came with parser 7. */
const STORED_SINCE: Readonly<Record<string, number>> = {
	"runs.duration_ms": 7,
};

/** Raw or text spec facts not stored yet, with where they land. */
const PENDING: Readonly<Record<string, string>> = {
	"calls.attribution_agent": "no non-null value seen yet; needs a fixture",
	"runs.context_input_tokens_at_start": "usage events, not the parser",
	"runs.compacted": "compaction records (kind), not a fact",
	"runs.pushed_shas":
		"push output (regex); gitOperation records only the branch",
	"prompts.instruction_sha256": "not in transcripts; drift census (step 11)",
};

interface SpecFact {
	readonly id: string;
	readonly today: string;
}

/** Fact names of the spec's view and session tables with their Today cell. */
async function readSpecFacts(): Promise<SpecFact[]> {
	const spec = await Bun.file(
		new URL("../../../../../docs/l1-literal-schema.md", import.meta.url),
	).text();
	const facts: SpecFact[] = [];
	let view: string | undefined;
	for (const line of spec.split("\n")) {
		const heading = /^#{2,3} (.*)$/u.exec(line)?.[1];
		if (heading !== undefined) {
			view =
				/^`(calls|runs|prompts)`/u.exec(heading)?.[1] ??
				(heading.startsWith("Session and workspace facts")
					? "session"
					: undefined);
			continue;
		}
		if (view === undefined || !line.startsWith("| ")) continue;
		const cells = line
			.split(" | ")
			.map((cell) => cell.replace(/^\| |\|$/gu, "").trim());
		const first = cells[0] ?? "";
		// Names in backticks are fields, not statuses (`text` is a column).
		const today = (cells.at(-1) ?? "").replace(/`[^`]*`/gu, "");
		if (/^(Column|Fact)$/u.test(first) || first.startsWith("---")) continue;
		const withoutNotes = first.replace(/\([^)]*\)/gu, "");
		const names = [...withoutNotes.matchAll(/`([^`]+)`/gu)].map(
			(m) => m[1] ?? "",
		);
		for (const name of names.length > 0 ? names : [withoutNotes.trim()])
			facts.push({ id: `${view}.${name}`, today });
	}
	return facts;
}

describe("L1 spec drift", () => {
	test("every raw or text fact in the spec is stored or pending", async () => {
		const facts = await readSpecFacts();
		expect(facts.length).toBeGreaterThan(50);
		const unplanned = facts.filter(
			(fact) =>
				/\b(raw|text|parser v\d+)\b/u.test(fact.today) &&
				STORED[fact.id] === undefined &&
				PENDING[fact.id] === undefined,
		);
		expect(unplanned.map((fact) => fact.id)).toEqual([]);
	});

	test("the spec marks every stored fact with the parser version that stores it", async () => {
		const facts = new Map(
			(await readSpecFacts()).map((fact) => [fact.id, fact]),
		);
		for (const [id, fields] of Object.entries(STORED)) {
			// The newest field decides; typed columns arrived with parser 6.
			const since =
				STORED_SINCE[id] ??
				Math.max(
					6,
					...fields.map((field) =>
						field in TRANSCRIPT_RECORD_FACT_KEYS
							? TRANSCRIPT_RECORD_FACT_KEYS[
									field as keyof typeof TRANSCRIPT_RECORD_FACT_KEYS
								]
							: 6,
					),
				);
			expect(
				`${id}: ${facts.get(id)?.today ?? "missing from the spec"}`,
			).toContain(`parser v${since}`);
		}
	});

	test("pending facts are in the spec and not stored", async () => {
		const facts = new Map(
			(await readSpecFacts()).map((fact) => [fact.id, fact]),
		);
		for (const id of Object.keys(PENDING)) {
			expect(facts.has(id)).toBe(true);
			expect(STORED[id]).toBeUndefined();
		}
	});
});
