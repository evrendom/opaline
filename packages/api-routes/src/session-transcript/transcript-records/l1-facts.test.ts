import { describe, expect, test } from "bun:test";
import { factText } from "./record-facts.js";
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
];

function findRow(
	rows: readonly TranscriptRecordDraft[],
	row: FactCase["row"],
): TranscriptRecordDraft {
	const match = rows.find(
		(draft) =>
			draft.kind === row.kind &&
			(row.callId === undefined || draft.callId === row.callId) &&
			(row.subtype === undefined || draft.subtype === row.subtype),
	);
	if (match === undefined) throw new Error(`No row ${JSON.stringify(row)}`);
	return match;
}

describe("parser v6 facts", () => {
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
		const outputs = (await split(FIXTURES.codex)).filter(
			(draft) => draft.kind === "tool_result" && draft.subtype !== "nested",
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
			"2.1.292",
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
			// Checked by the fact budget test above.
			"facts_truncated",
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
	"runs.entrypoint": ["entrypoint"],
	"runs.agent_version": ["agentVersion"],
	"runs.pr_repository": ["pr_repository"],
	"runs.pr_number": ["pr_number", "pr_url"],
};

/** Raw or text spec facts not stored yet, with where they land. */
const PENDING: Readonly<Record<string, string>> = {
	"calls.spawned_agent_id": "parser 7 (Codex spawned thread ids)",
	"calls.attribution_agent": "no non-null value seen yet; needs a fixture",
	"runs.duration_ms": "parser 7",
	"runs.time_to_first_token_ms": "parser 7",
	"runs.auto_mode_*": "parser 7",
	"runs.approval_policy": "parser 7",
	"runs.approvals_reviewer": "parser 7",
	"runs.sandbox_policy": "parser 7",
	"runs.permission_profile": "parser 7",
	"runs.model": "parser 7 (usage stays authoritative)",
	"runs.effort": "parser 7",
	"runs.context_window": "parser 7",
	"runs.context_input_tokens_at_start": "parser 7",
	"runs.compacted": "parser 7",
	"runs.compact_trigger": "parser 7",
	"runs.compact_pre_tokens": "parser 7",
	"runs.aborted": "parser 7",
	"runs.abort_reason": "parser 7",
	"runs.turn_error": "parser 7",
	"runs.stop_reason": "parser 7",
	"runs.hook_stop_reason": "parser 7",
	"runs.hook_errors": "parser 7",
	"runs.prevented_continuation": "parser 7",
	"runs.hook_runs": "parser 7",
	"runs.api_errors": "parser 7",
	"runs.retry_attempts": "parser 7",
	"runs.refusals": "parser 7",
	"runs.fallback_model": "parser 7",
	"runs.goal": "parser 7",
	"runs.pushed_shas": "git extractor 4",
	"runs.prompt_origin": "parser 8",
	"prompts.prompt_origin": "parser 8",
	"session.cost_state": "parser 8",
	"session.title": "parser 8",
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
				/\b(raw|text|parser v6)\b/u.test(fact.today) &&
				STORED[fact.id] === undefined &&
				PENDING[fact.id] === undefined,
		);
		expect(unplanned.map((fact) => fact.id)).toEqual([]);
	});

	test("the spec marks every stored fact as stored by parser v6", async () => {
		const facts = new Map(
			(await readSpecFacts()).map((fact) => [fact.id, fact]),
		);
		for (const id of Object.keys(STORED)) {
			expect(facts.get(id)?.today ?? `${id} missing from the spec`).toContain(
				"parser v6",
			);
		}
	});

	test("pending facts are still open in the spec", async () => {
		const facts = new Map(
			(await readSpecFacts()).map((fact) => [fact.id, fact]),
		);
		for (const id of Object.keys(PENDING)) {
			expect(facts.get(id)?.today ?? `${id} missing from the spec`).toMatch(
				/\b(raw|text|regex)\b/u,
			);
		}
	});
});
