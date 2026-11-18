import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import v9Cases from "../__fixtures__/l1-facts/v9-cases.json" with {
	type: "json",
};
import {
	type AgentFact,
	type CatalogFactField,
	type CatalogRecordColumn,
	FACT_AGENTS,
	FACT_CATALOG,
	type FactAgent,
	factCatalogIndex,
} from "./fact-catalog.js";
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
	TRANSCRIPT_RECORD_FACTS_SINCE_PARSER_VERSION,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptRecordDraft,
	type TranscriptRecordFacts,
	type TranscriptSource,
} from "./types.js";
import { V9_SOURCE_FACTS } from "./v9-fact-sources.js";
import { V9_REGRESSION_COVERAGE } from "./v9-regressions.test.js";

/**
 * The literal facts of the L1 fact catalog (fact-catalog.ts), one fixture
 * case per stored fact and agent, from real Claude Code 2.1.29x and Codex
 * 0.156 lines with values replaced. The catalog checks below fail when a
 * registered fact or a fact of docs/l1-literal-schema.md has no catalog
 * entry, when a stored fact loses its case for an agent, or when an entry
 * lacks its evidence (a search for an absence, a plan for a gap or a bug).
 * Cases of facts the catalog marks `wrong` pin today's behaviour; the fix
 * changes both.
 */

const FIXTURES = {
	claude: "l1-facts/claude-2.1.jsonl",
	codex: "l1-facts/codex-0.156.jsonl",
	codexDirect: "codex-direct-era.jsonl",
	codexEndEvent: "codex-end-event-era.jsonl",
	codexCustomExec: "codex-custom-exec-era.jsonl",
	claudeRecordIds: "l1-facts/claude-record-ids.jsonl",
	claudeImages: "l1-facts/claude-images.jsonl",
	claudeSubagent: "l1-facts/claude-subagent-2.1.jsonl",
	codexSkill: "l1-facts/codex-skill-0.162.jsonl",
	codexScript: "codex-script-era-commands.jsonl",
	codexInner: "l1-facts/codex-inner-calls-0.153.jsonl",
	claudeCapture: "l1-facts/claude-capture-2.1.jsonl",
	codexCapture: "l1-facts/codex-capture-0.162.jsonl",
} as const;

/** The agent that wrote each fixture. */
function fixtureAgent(fixture: keyof typeof FIXTURES): FactAgent {
	return FIXTURES[fixture].includes("claude") ? "claude_code" : "codex";
}
const IDENTITY_FIXTURES = [
	"claude-subagent-turns.jsonl",
	"codex-custom-exec-era.jsonl",
	"codex-direct-era.jsonl",
	"codex-end-event-era.jsonl",
	"codex-subagent-turns.jsonl",
	FIXTURES.claude,
	FIXTURES.claudeSubagent,
	FIXTURES.codex,
] as const;

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
	readonly facts?: Partial<Omit<TranscriptRecordFacts, "extra">> & {
		readonly extra?: Partial<
			Record<keyof typeof TRANSCRIPT_RECORD_FACT_KEYS, string>
		>;
	};
	/** Record columns the row holds (facts stored as columns, not facts). */
	readonly columns?: Partial<Pick<TranscriptRecordDraft, CatalogRecordColumn>>;
}

const CASES: readonly FactCase[] = [
	{
		name: "a shell call lists every file it reads, resolved against its directory",
		fixture: "claudeCapture",
		row: { callId: "toolu_docs", kind: "tool_call" },
		facts: {
			extra: {
				files_read: JSON.stringify([
					"/Users/dev/work/app/docs/CLAUDE.md",
					"/Users/dev/work/app/AGENTS.md",
					"/Users/dev/work/app/docs/notes.md",
					"/Users/dev/work/app/README.md",
				]),
			},
		},
	},
	{
		name: "a compound command keeps each program's class",
		fixture: "claudeCapture",
		row: { callId: "toolu_checks", kind: "tool_call" },
		facts: {
			extra: {
				command_classes: JSON.stringify(["test", "typecheck", "other"]),
			},
		},
	},
	{
		name: "a compaction summary names the boundary it repeats",
		fixture: "claudeCapture",
		row: { kind: "compaction", subtype: "compact_summary" },
		facts: { extra: { compaction_of: "12" } },
	},
	{
		name: "a hook block Claude Code records as permission-rule is a hook refusal",
		fixture: "claudeCapture",
		row: { callId: "toolu_hook", kind: "tool_result" },
		facts: { denialKind: "hook" },
	},
	{
		name: "a Codex command lists the files it reads against its workdir",
		fixture: "codexCapture",
		row: { callId: "call_read", kind: "tool_call" },
		facts: {
			extra: {
				files_read: JSON.stringify([
					"/Users/dev/work/app/pkg/AGENTS.md",
					"/Users/dev/notes.md",
				]),
				command_classes: JSON.stringify(["other", "typecheck"]),
			},
		},
	},
	{
		name: "a Codex compaction event names the compacted record it repeats",
		fixture: "codexCapture",
		row: { kind: "compaction", nth: 1 },
		facts: { extra: { compaction_of: "6" } },
	},
	{
		name: "a script failure an inner call threw names that call",
		fixture: "codexInner",
		row: { callId: "call_script_mcp", kind: "tool_result" },
		facts: {
			extra: {
				error_from_call_id: "exec-11111111-1111-4111-8111-111111111111",
			},
		},
	},
	{
		name: "a Codex prompt names its turn's working directory",
		fixture: "codexInner",
		row: { kind: "user_prompt" },
		facts: { extra: { turn_cwd: "/Users/dev/work/app-feature" } },
	},
	{
		name: "a script command names the directory it asked to run in",
		fixture: "codexScript",
		row: {
			callId: "call_IrGZgx3YoqyINGGE51fGUUE0#1",
			kind: "tool_call",
			subtype: "script",
		},
		facts: {
			extra: { workdir: "/Users/dev/conductor/workspaces/rudel-v2/almaty-v1" },
		},
	},
	{
		name: "a command a code-mode script runs names its script",
		fixture: "codexScript",
		row: {
			callId: "call_IrGZgx3YoqyINGGE51fGUUE0#1",
			kind: "tool_call",
			subtype: "script",
		},
		facts: { extra: { script_call_id: "call_IrGZgx3YoqyINGGE51fGUUE0" } },
	},
	{
		name: "a script counts the commands it builds at run time",
		fixture: "codexScript",
		row: { callId: "call_pJ3Rouz74vZJNN0AiZyHkoXP", kind: "tool_call" },
		facts: { extra: { script_commands_unresolved: "1" } },
	},
	{
		name: "a background Bash hand-off names its task",
		fixture: "claude",
		row: { callId: "toolu_dev", kind: "tool_result", subtype: "running" },
		facts: { extra: { task_id: "bdev12345", background_launch: "requested" } },
	},
	{
		name: "a call its timeout moved to the background names its task",
		fixture: "claude",
		row: { callId: "toolu_slow", kind: "tool_result", subtype: "running" },
		facts: { extra: { task_id: "bslow6789", background_launch: "timeout" } },
	},
	{
		name: "a killed task's notification carries its call and status",
		fixture: "claude",
		row: {
			callId: "toolu_dev",
			kind: "injected_context",
			subtype: "task_notification",
		},
		facts: { extra: { task_id: "bdev12345", background_status: "killed" } },
	},
	{
		name: "a notification without a tool use finds its call by task id, with its exit code",
		fixture: "claude",
		row: {
			callId: "toolu_slow",
			kind: "injected_context",
			subtype: "task_notification",
		},
		facts: {
			extra: {
				task_id: "bslow6789",
				background_status: "failed",
				background_exit_code: "1",
			},
		},
	},
	{
		name: "a Monitor event is a task event of its Monitor call",
		fixture: "claude",
		row: {
			callId: "toolu_watch",
			kind: "injected_context",
			subtype: "task_notification",
		},
		facts: { extra: { task_id: "bmon00001", task_event: "true" } },
	},
	{
		name: "a PreToolUse hook block is a hook refusal",
		fixture: "claude",
		row: { callId: "toolu_install", kind: "tool_result" },
		facts: {
			denialKind: "hook",
			extra: {
				hook_event: "PreToolUse",
				denial_reason:
					"STOP: This command cannot install or download packages.",
			},
		},
	},
	{
		name: "a compound read names its first file and lists every file it reads",
		fixture: "claude",
		row: { callId: "toolu_reads", kind: "tool_call" },
		facts: {
			extra: {
				shell_read_paths: JSON.stringify([
					"/repo/src/view.tsx",
					"/repo/src/chips.tsx",
					"/repo/tools/run-tests.ts",
				]),
			},
		},
		columns: { filePath: "/repo/src/view.tsx", fileOp: "read" },
	},
	{
		name: "a list exits with its last part, whose glob zsh found no match for",
		fixture: "claude",
		row: { callId: "toolu_reads", kind: "tool_result" },
		facts: {
			extra: {
				exit_decided_by: "ls web/vitest.config.* 2>/dev/null",
				exit_masked: "list",
				no_output: "false",
			},
		},
	},
	{
		name: "a CI watch piped through grep and tail printed nothing and exits with tail",
		fixture: "claude",
		row: { callId: "toolu_ciwatch", kind: "tool_result" },
		facts: {
			extra: {
				exit_decided_by: "tail -2",
				exit_masked: "list,pipe",
				no_output: "true",
			},
		},
	},
	{
		name: "a Python heredoc edit is a shell_script edit of the path it names",
		fixture: "claude",
		row: {
			callId: "toolu_pyedit1",
			kind: "file_change",
			subtype: "shell_script",
		},
		columns: { filePath: "/repo/web/src/view.tsx", fileOp: "edit" },
	},
	{
		name: "a python -c edit retrying a failed edit of the same file names it",
		fixture: "claude",
		row: { callId: "toolu_pyedit2", kind: "tool_call" },
		facts: { extra: { retry_of: "toolu_pyedit1" } },
		columns: { filePath: "/repo/web/src/view.tsx" },
	},
	{
		name: "a call the user interrupted is interrupted, not refused",
		fixture: "claude",
		row: { callId: "toolu_serve", kind: "tool_result" },
		facts: { interrupted: true, denialKind: "" },
	},
	{
		name: "a rejected question stays a refusal, not an interruption",
		fixture: "claude",
		row: { callId: "toolu_reject", kind: "tool_result" },
		facts: { denialKind: "user-rejected", interrupted: null },
	},
	{
		// A subagent transcript keeps no toolUseResult: the hand-off text is
		// the only record of the timeout, and its limit (parser 12).
		name: "a subagent call its timeout moved to the background names its task and the limit its hand-off text names",
		fixture: "claudeSubagent",
		row: { callId: "toolu_sub_slow", kind: "tool_result", subtype: "running" },
		facts: {
			timedOutAfterMs: 120_000,
			extra: { task_id: "bsub12345", background_launch: "timeout" },
		},
	},
	{
		name: "a subagent's safety-classifier stop is a safety_recovery notice",
		fixture: "claudeSubagent",
		row: {
			kind: "injected_context",
			subtype: "safety_recovery",
			text: "stopped by a safety classifier",
		},
	},
	{
		name: "a subagent's commit records no git operation, interruption or duration",
		fixture: "claudeSubagent",
		row: { callId: "toolu_sub_commit", kind: "tool_result" },
		facts: { gitOperation: [], interrupted: null, durationMs: null },
	},
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
				shell_edit_changed_files: JSON.stringify(
					Array.from(
						{ length: 60 },
						(_, index) =>
							`/repo/packages/generated/src/module-${String(index).padStart(3, "0")}/index.generated.ts`,
					),
				),
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
		name: "search files remain distinct from match and line counts",
		fixture: "claude",
		row: { callId: "toolu_grep", kind: "tool_result" },
		facts: { extra: { files_found: "3" } },
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
				permission_profile_kind: "managed",
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
				goal_status: "active",
				goal_time_used_seconds: "22",
				goal_tokens_used: "1200",
			},
		},
	},
	{
		name: "Codex sub-agent activity is not a spawn",
		fixture: "codex",
		row: { kind: "meta", subtype: "item_completed:SubAgentActivity" },
		facts: {
			extra: {
				subagent_activity_components:
					'[{"path":"event_msg/item_completed:SubAgentActivity.kind","ordinal":0,"value":"interacted"},{"path":"event_msg/item_completed:SubAgentActivity.agent_thread_id","ordinal":0,"value":"01a10b68-012e-7a60-b141-5c0ccce6bc01"}]',
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
		facts: { extra: {} },
	},
	{
		name: "long hook lists are cut and counted; long entries are marked clipped",
		fixture: "claude",
		row: { kind: "meta", subtype: "system:stop_hook_summary", nth: 0 },
		facts: {
			extra: {
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
		facts: { extra: {} },
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
		name: "parser 12 keeps a Codex session_meta's git remote with the directory it names",
		fixture: "codex",
		row: { kind: "meta", subtype: "session_meta" },
		facts: {
			extra: {
				thread_source: "user",
				git_remote: "https://github.com/acme/widget.git",
				git_remote_cwd: "/repo",
			},
		},
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
		// A `$skill` mention injects the skill's SKILL.md as a user message.
		name: "Codex skill a $skill mention injected",
		fixture: "codexSkill",
		row: { kind: "injected_context", subtype: "skill_body" },
		facts: { extra: { skill: "testing-bun" } },
	},
	{
		name: "a long read path list is cut to whole paths and counted",
		fixture: "codex",
		row: { callId: "nested_reads", kind: "tool_result" },
		facts: { extra: {} },
	},
	{
		name: "Claude tool, call id and command",
		fixture: "claude",
		row: { callId: "toolu_push", kind: "tool_call" },
		columns: {
			callId: "toolu_push",
			text: "git push -u origin fix/login",
			toolName: "Bash",
		},
	},
	{
		name: "Claude result length",
		fixture: "claude",
		row: { callId: "toolu_push", kind: "tool_result" },
		columns: { textChars: 54 },
	},
	{
		name: "Claude refused call is an error",
		fixture: "claude",
		row: { callId: "toolu_rm", kind: "tool_result" },
		columns: { exitCode: null, isError: true },
	},
	{
		name: "a refused Claude rm preserves its requested delete operation",
		fixture: "claude",
		row: { callId: "toolu_rm", kind: "file_change" },
		columns: { fileOp: "delete", filePath: "/repo/node_modules" },
	},
	{
		name: "Claude native edit",
		fixture: "claude",
		row: { callId: "toolu_edit", kind: "file_change" },
		columns: { fileOp: "edit", filePath: "/repo/src/a.ts" },
	},
	{
		name: "Claude sub-agent the call started",
		fixture: "claude",
		row: { callId: "toolu_agent", kind: "tool_result" },
		columns: { spawnedAgentId: "a1b2c3" },
	},
	{
		name: "Claude search input",
		fixture: "claude",
		row: { callId: "toolu_grep", kind: "tool_call" },
		columns: {
			text: '{"pattern":"TODO","output_mode":"files_with_matches"}',
		},
	},
	{
		name: "Claude compaction boundary",
		fixture: "claude",
		row: { kind: "compaction" },
		columns: { kind: "compaction", subtype: "compact_boundary" },
	},
	{
		name: "Claude prompt",
		fixture: "claude",
		row: { kind: "user_prompt", text: "ship the fix" },
		columns: {
			kind: "user_prompt",
			subtype: "",
			text: "ship the fix and open a PR",
			textChars: 26,
		},
	},
	{
		name: "a tool result's screenshot is listed by its upload marker",
		fixture: "claudeImages",
		row: { callId: "toolu_shot", kind: "tool_result" },
		facts: {
			extra: {
				images: JSON.stringify([
					{
						sha256:
							"3b39b023b25be13038559fef0c4177bcb109323b43b949a47088a1a3093b204a",
						bytes: 391022,
						type: "image/png",
					},
				]),
			},
		},
	},
	{
		name: "Claude record id on every record of its line",
		fixture: "claudeRecordIds",
		row: { callId: "toolu_ids", kind: "tool_call" },
		columns: { recordUuid: "0c5f2b9e-3d41-4a8f-b6e2-7f9d1c3a5e02" },
	},
	{
		name: "Codex tool, call id and command",
		fixture: "codex",
		row: { callId: "call_cmd", kind: "tool_call" },
		columns: {
			callId: "call_cmd",
			text: "bun run build",
			toolName: "exec_command",
		},
	},
	{
		name: "Codex result length and exit code",
		fixture: "codex",
		row: { callId: "call_cmd", kind: "tool_result" },
		columns: { exitCode: null, isError: false, textChars: 2 },
	},
	{
		name: "a refused Codex call is an error",
		fixture: "codex",
		row: { callId: "call_rejected", kind: "tool_result" },
		columns: { exitCode: null, isError: true },
	},
	{
		name: "a Codex output still running",
		fixture: "codex",
		row: { callId: "call_late", kind: "tool_result", subtype: "running" },
		columns: { exitCode: null, isError: false, subtype: "running" },
	},
	{
		name: "a late Codex completion preserves its literal exit code",
		fixture: "codex",
		row: {
			callId: "call_late",
			kind: "meta",
			subtype: "item_completed:CommandExecution_mirror",
		},
		columns: { exitCode: 0, isError: false },
	},
	{
		name: "Codex prompt",
		fixture: "codex",
		row: { kind: "user_prompt" },
		columns: {
			kind: "user_prompt",
			subtype: "",
			text: "check the build",
			textChars: 15,
		},
	},
	{
		name: "Codex failed command",
		fixture: "codexDirect",
		row: { callId: "failure", kind: "tool_result" },
		columns: { exitCode: 127, isError: true },
	},
	{
		name: "Codex patch file",
		fixture: "codexDirect",
		row: { callId: "direct-patch", kind: "file_change" },
		columns: { fileOp: "write", filePath: "src/new.ts" },
	},
	{
		name: "a failed Codex patch preserves its requested write operation",
		fixture: "codexEndEvent",
		row: { callId: "failed-patch", kind: "file_change" },
		columns: { fileOp: "write", filePath: "failed.ts" },
	},
	{
		name: "Codex compaction",
		fixture: "codexCustomExec",
		row: { kind: "compaction" },
		columns: { kind: "compaction", subtype: "compacted" },
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
		const { extra, ...typed } = item.facts ?? {};
		expect(draft.facts).toMatchObject(typed);
		if (extra !== undefined) {
			expect(draft.facts.extra).toMatchObject(extra);
		}
		if (item.columns !== undefined) expect(draft).toMatchObject(item.columns);
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
			applied_changes: JSON.stringify([
				{ path: "/repo/src/a.ts" },
				{ path: "/repo/src/new.ts", created: true },
				{ path: "/repo/src/old.ts", deleted: true },
			]),
			facts_truncated: "true",
			no_output: "true",
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
		expect(wait.facts.extra).toEqual({
			timeout_ms: "1200000",
			facts_truncated: "true",
		});
		// Records with no facts map are untouched.
		const prompt = findRow(rows, { kind: "user_prompt" });
		expect(prompt.facts.extra).toEqual({ facts_truncated: "true" });
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
		expect(goal.facts.extra.goal?.length).toBe(goal.text.length);
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
		expect(call.facts).toMatchObject({
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

	test("every emitted key is registered", async () => {
		const registered = new Set(Object.keys(TRANSCRIPT_RECORD_FACT_KEYS));
		for (const name of Object.values(FIXTURES)) {
			for (const draft of await split(name)) {
				for (const key of Object.keys(draft.facts.extra))
					expect(registered).toContain(key);
			}
		}
		for (const since of Object.values(TRANSCRIPT_RECORD_FACT_KEYS))
			expect(since).toBeLessThanOrEqual(TRANSCRIPT_RECORDS_PARSER_VERSION);
	});

	test("past the session fact budget, a Codex record says its long values were dropped", async () => {
		const content = await Bun.file(
			new URL(`../__fixtures__/${FIXTURES.codex}`, import.meta.url),
		).text();
		const rows = [
			...splitSessionTranscript({
				content,
				factBudgetChars: 0,
				sessionDate: "2026-10-01T09:00:00.000Z",
				source: "codex",
			}),
		];
		const reads = findRow(rows, {
			callId: "call_cmd",
			kind: "meta",
			subtype: "item_completed:CommandExecution_mirror",
		});
		expect(reads.facts.extra).toEqual({
			facts_truncated: "true",
			parsed_cmd_types: JSON.stringify(["read", "unknown"]),
		});
	});

	test("record identities match parser v5, so run ids and edges stay stable", async () => {
		const expected = (await Bun.file(
			new URL(
				"../__fixtures__/l1-facts/record-identities.v5.json",
				import.meta.url,
			),
		).json()) as Record<string, string[]>;
		for (const name of IDENTITY_FIXTURES) {
			const identities = (await split(name))
				.filter((draft) => draft.subtype !== "script")
				.map((draft) =>
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

/** Facts checked by the named tests above rather than a case, per agent. */
const COVERED_ELSEWHERE: Readonly<Record<FactAgent, ReadonlySet<string>>> = {
	// The fact budget tests; received setup in received-setup.test.ts.
	// The cap of shell_read_paths in shell-access.test.ts, of images in image-facts.test.ts,
	// of files_read (one list builder for both agents) in capture-facts.test.ts.
	claude_code: new Set([
		"body_sha256",
		"facts_truncated",
		"text_cut",
		"images_more",
		"received_setup",
		"shell_read_paths_more",
		"files_read_more",
		...V9_REGRESSION_COVERAGE.claude_code,
	]),
	// The fact budget and goal text tests; received setup in received-setup.test.ts.
	codex: new Set([
		"body_sha256",
		"facts_truncated",
		"text_cut",
		"goal",
		"received_setup",
		"files_read_more",
		...V9_REGRESSION_COVERAGE.codex,
	]),
};

/** Fact fields and record columns each agent's cases assert. */
function caseCoverage(): Map<FactAgent, Set<string>> {
	const coverage = new Map<FactAgent, Set<string>>(
		FACT_AGENTS.map((agent) => [agent, new Set(COVERED_ELSEWHERE[agent])]),
	);
	for (const item of CASES) {
		const covered = coverage.get(fixtureAgent(item.fixture));
		for (const key of [
			...Object.keys(item.facts ?? {}),
			...Object.keys(item.facts?.extra ?? {}),
			...Object.keys(item.columns ?? {}).map((column) => `record.${column}`),
		])
			if (key !== "extra") covered?.add(key);
	}
	for (const witness of v9Cases)
		coverage
			.get(witness.agent === "codex" ? "codex" : "claude_code")
			?.add(witness.key);
	for (const mapping of V9_SOURCE_FACTS)
		coverage.get(mapping.agent)?.add(mapping.moreKey);
	return coverage;
}

type Stored = Extract<AgentFact, { status: "stored" | "wrong" }>;

function storedFacts(): { id: string; agent: FactAgent; fact: Stored }[] {
	return FACT_CATALOG.flatMap((entry) =>
		FACT_AGENTS.flatMap((agent) => {
			const fact = entry.agents[agent];
			return fact.status === "stored" || fact.status === "wrong"
				? [{ id: `${entry.view}.${entry.id}`, agent, fact }]
				: [];
		}),
	);
}

/** The parser version that registered a fact field. */
function registeredSince(field: CatalogFactField): number {
	return field in TRANSCRIPT_RECORD_FACT_KEYS
		? TRANSCRIPT_RECORD_FACT_KEYS[
				field as keyof typeof TRANSCRIPT_RECORD_FACT_KEYS
			]
		: TRANSCRIPT_RECORD_FACTS_SINCE_PARSER_VERSION;
}

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

describe("L1 fact catalog", () => {
	test("every registered fact key and typed fact column is stored by an entry", () => {
		const typed = Object.keys(NO_TRANSCRIPT_RECORD_FACTS).filter(
			(key) => key !== "extra",
		);
		const stored = new Set(
			storedFacts().flatMap(({ fact }) => fact.stores.facts ?? []),
		);
		const missing = [
			...typed,
			...Object.keys(TRANSCRIPT_RECORD_FACT_KEYS),
		].filter((key) => !stored.has(key as CatalogFactField));
		expect(missing).toEqual([]);
	});

	test("each stored fact names the parser version that stores it, no earlier than its registry version", () => {
		const problems: string[] = [];
		for (const { id, agent, fact } of storedFacts()) {
			const { facts = [], record = [], since } = fact.stores;
			if (facts.length === 0 && record.length === 0) continue;
			const earliest = Math.max(1, ...facts.map(registeredSince));
			if (
				since === undefined ||
				since < earliest ||
				since > TRANSCRIPT_RECORDS_PARSER_VERSION
			)
				problems.push(
					`${id} (${agent}): since ${since}, registered ${earliest}`,
				);
		}
		expect(problems).toEqual([]);
	});

	test("every stored fact has a fixture case for its agent", () => {
		const coverage = caseCoverage();
		const uncovered: string[] = [];
		for (const { id, agent, fact } of storedFacts()) {
			const covered = coverage.get(agent) ?? new Set<string>();
			const { facts = [], record = [], elsewhere } = fact.stores;
			for (const field of facts)
				if (!covered.has(field)) uncovered.push(`${id} ${agent} ${field}`);
			for (const column of record)
				if (!covered.has(`record.${column}`) && fact.testedIn === undefined)
					uncovered.push(`${id} ${agent} record.${column}`);
			if (
				facts.length === 0 &&
				record.length === 0 &&
				(elsewhere === undefined || fact.testedIn === undefined)
			)
				uncovered.push(`${id} ${agent}: stored elsewhere needs a test`);
		}
		expect(uncovered).toEqual([]);
	});

	test("every entry carries its evidence: a search for an absence, a plan for a gap or a bug", () => {
		const root = new URL("../../../../../", import.meta.url).pathname;
		const problems: string[] = [];
		for (const entry of FACT_CATALOG) {
			if (entry.meaning.trim() === "" || !entry.meaning.endsWith("."))
				problems.push(`${entry.id}: meaning must be one sentence`);
			for (const agent of FACT_AGENTS) {
				const fact = entry.agents[agent];
				const label = `${entry.view}.${entry.id} (${agent})`;
				if (fact.status === "not_recorded" && fact.searched.trim() === "")
					problems.push(`${label}: not_recorded without searched`);
				if (
					(fact.status === "pending" || fact.status === "wrong") &&
					fact.plan.trim() === ""
				)
					problems.push(`${label}: ${fact.status} without a plan`);
				if (
					(fact.status === "stored" || fact.status === "wrong") &&
					fact.gap !== undefined
				) {
					if (fact.gap.sources.length === 0 || fact.gap.plan.trim() === "")
						problems.push(`${label}: a gap needs sources and a plan`);
				}
				if (
					(fact.status === "stored" || fact.status === "wrong") &&
					fact.testedIn !== undefined &&
					!existsSync(`${root}${fact.testedIn}`)
				)
					problems.push(`${label}: ${fact.testedIn} does not exist`);
			}
		}
		expect(problems).toEqual([]);
	});

	test("entries are unique by view and name", () => {
		const names = FACT_CATALOG.flatMap((entry) =>
			[entry.view, ...(entry.alsoIn ?? [])].flatMap((view) =>
				[entry.id, ...(entry.also ?? [])].map((id) => `${view}.${id}`),
			),
		);
		expect(names.length).toBe(new Set(names).size);
	});

	test("every fact of the spec's view and session tables has a catalog entry", async () => {
		const facts = await readSpecFacts();
		expect(facts.length).toBeGreaterThan(50);
		const index = factCatalogIndex();
		expect(facts.map((fact) => fact.id).filter((id) => !index.has(id))).toEqual(
			[],
		);
	});
});
