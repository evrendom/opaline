import { describe, expect, test } from "bun:test";
import {
	encodeTranscriptRecordsReceipt,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import { CALL_FACTS_TABLE } from "@rudel/ch-schema/call-facts";
import type {
	RudelCallFactsRow,
	RudelRunIndexRow,
	RudelRunRequestsRow,
	RudelRunSetupRow,
} from "@rudel/ch-schema/generated";
import { RUN_SETUP_TABLE } from "@rudel/ch-schema/received-setup";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { ClickHouseWriteFencedError } from "../../lib/clickhouse-write-fence.js";
import { NO_CODEX_LIFECYCLE_FACTS } from "../analysis/codex-lifecycle.js";
import { gateRunIndexRow } from "../analysis/run-index-columns.js";
import {
	buildRunIndexStatement,
	buildUnattributedUsageStatement,
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
	type RunIndexFactsRow,
	RunIndexFactsRowSchema,
	type RunRequestFactsRow,
	type UnattributedUsageRow,
} from "../analysis/run-index-sql.js";
import { buildRunFactsStatement } from "../analysis/run-queries.js";
import { selectRetiredGenerations } from "../transcript-records-ingest.service.js";
import { callTuple } from "./call-facts.fixtures.js";
import { runNodeId } from "./l1-edge-ids.js";
import { RUN_REQUESTS_TABLE } from "./l1-edge-tables.js";
import {
	assertUsageConserved,
	buildRunIndex,
	carriedMcpUnavailable,
	RunIndexUsageChangedError,
	runIndexUsage,
	runRow,
	runUnknownColumns,
	selectRetiredSnapshots,
} from "./run-index.service.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const session = { userId: "u/1", source: "claude_code", sessionId: "s 1" };
const scope = { organizationId: "org", userId: session.userId };

/** A run's facts with nothing recorded: '' strings, zero counts, empty sets. */
function facts(overrides: Partial<RunIndexFactsRow> = {}): RunIndexFactsRow {
	const shape = RunIndexFactsRowSchema.shape as Record<
		string,
		{ safeParse(value: unknown): { success: boolean; data?: unknown } }
	>;
	const row: Record<string, unknown> = {};
	for (const [key, schema] of Object.entries(shape))
		for (const candidate of ["", [], null]) {
			const parsed = schema.safeParse(candidate);
			if (parsed.success) {
				row[key] = parsed.data;
				break;
			}
		}
	return {
		...(row as RunIndexFactsRow),
		session_id: session.sessionId,
		cost_usd: null,
		uncached_input_tokens: null,
		cache_read_input_tokens: null,
		cache_write_5m_input_tokens: null,
		cache_write_1h_input_tokens: null,
		output_tokens: null,
		reasoning_output_tokens: null,
		context_input_tokens_at_start: null,
		started_ms: NOW.getTime() - 60_000,
		ended_ms: NOW.getTime(),
		...overrides,
	};
}

interface UsageState {
	generation: string;
	receipts: number;
	complete: number;
	expected_events: number;
	receipt_deleted: number;
	checksum: string;
	generation_events: number;
	active_events: number;
}
const CONSISTENT: UsageState = {
	generation: "12",
	receipts: 1,
	complete: 1,
	expected_events: 2,
	receipt_deleted: 0,
	checksum: "abc",
	generation_events: 2,
	active_events: 2,
};
const NO_USAGE: UsageState = {
	...CONSISTENT,
	generation: "0",
	receipts: 0,
	complete: 0,
	expected_events: 0,
	checksum: "",
	generation_events: 0,
	active_events: 0,
};

/** The usage no run claims: both events of the extraction, conserved. */
function unattributed(events: number): UnattributedUsageRow {
	const tokens = (value: string) => (events === 0 ? null : value);
	return {
		usage_observations: events,
		usage_unpriced: events === 0 ? 0 : 1,
		usage_model: events === 0 ? "" : "claude-opus-5-5",
		cost_usd: events === 0 ? null : 0.5,
		model_costs: events === 0 ? [] : [["claude-opus-5-5", 0.5, 1]],
		uncached_input_tokens: tokens("10"),
		cache_read_input_tokens: tokens("0"),
		cache_write_5m_input_tokens: tokens("0"),
		cache_write_1h_input_tokens: tokens("0"),
		output_tokens: tokens("5"),
		reasoning_output_tokens: tokens("0"),
		context_input_tokens_at_start: tokens("10"),
		total_observations: events,
		total_unpriced: events === 0 ? 0 : 1,
		total_cost_usd: events === 0 ? null : 0.5,
		total_uncached_input_tokens: events === 0 ? "0" : "10",
		total_cache_read_input_tokens: "0",
		total_cache_write_5m_input_tokens: "0",
		total_cache_write_1h_input_tokens: "0",
		total_output_tokens: events === 0 ? "0" : "5",
		total_reasoning_output_tokens: "0",
	};
}

interface Fake {
	executor: ClickHouseExecutor;
	/** Every row inserted, as the table holds it. */
	table: RudelRunIndexRow[];
	requests: RudelRunRequestsRow[];
	setup: RudelRunSetupRow[];
	calls: RudelCallFactsRow[];
	inserts: { values: RudelRunIndexRow[]; token?: string }[];
	executed: ClickHouseStatement[];
	events: string[];
}

const snapshotKey = (row: RudelRunIndexRow) => [
	BigInt(row.revision),
	BigInt(row.parser_version),
	BigInt(row.index_version),
	BigInt(row.build_revision),
];
const newer = (a: bigint[], b: bigint[]) => {
	for (let index = 0; index < a.length; index++) {
		if ((a[index] ?? 0n) !== (b[index] ?? 0n))
			return (a[index] ?? 0n) > (b[index] ?? 0n);
	}
	return false;
};

/**
 * ClickHouse answering each build statement by what it reads. The run index
 * is a table of the rows inserted; the reader returns the committed
 * snapshot's rows, as the real reader does.
 */
function fakeClickHouse(state: {
	parserVersion?: number;
	records?: number;
	/** Usage states, one per read; the last repeats. */
	usage?: UsageState[];
	runs?: RunIndexFactsRow[];
	requests?: RunRequestFactsRow[];
	snapshots?: Record<string, unknown>[];
	committed?: boolean;
	sessionDateMs?: number;
	failReceipt?: boolean;
	table?: RudelRunIndexRow[];
	/** What the generation records as each run's opening prompt and last message. */
	messages?: Record<string, unknown>[];
	/** Records that carried setup, compactions, edits and the session context. */
	setupRecords?: Record<string, unknown>[];
	gitRemote?: string;
	directories?: Record<string, unknown>[];
	evidence?: Record<string, unknown>[];
	mcpStates?: Record<string, unknown>[];
	calls?: unknown[];
}): Fake {
	const usage = [...(state.usage ?? [CONSISTENT])];
	const fake: Fake = {
		table: state.table ?? [],
		requests: [],
		setup: [],
		calls: [],
		inserts: [],
		executed: [],
		events: [],
		executor: {
			async close() {},
			async execute(statement) {
				fake.events.push("delete");
				fake.executed.push(statement);
			},
			async insert(params) {
				if (params.table === RUN_REQUESTS_TABLE) {
					fake.events.push("insert:requests");
					fake.requests.push(...(params.values as RudelRunRequestsRow[]));
					return;
				}
				if (params.table === CALL_FACTS_TABLE) {
					fake.events.push("insert:calls");
					fake.calls.push(...(params.values as RudelCallFactsRow[]));
					return;
				}
				if (params.table === RUN_SETUP_TABLE) {
					fake.events.push("insert:setup");
					fake.setup.push(...(params.values as RudelRunSetupRow[]));
					return;
				}
				const values = params.values as RudelRunIndexRow[];
				const receipt = values[0]?.row_kind === "receipt";
				fake.events.push(receipt ? "insert:receipt" : "insert:runs");
				if (receipt && state.failReceipt) throw new Error("connection reset");
				fake.inserts.push({ values, token: params.deduplicationToken });
				fake.table.push(...values);
			},
			async query<T>(statement: ClickHouseStatement) {
				const sql = statement.query;
				const rows = (): unknown[] => {
					if (sql.includes("LIMIT 1 BY session_id"))
						return state.committed === false
							? []
							: [
									{
										session_id: session.sessionId,
										revision_text: "7",
										parser_version: state.parserVersion ?? 8,
										receipt: encodeTranscriptRecordsReceipt({
											contentSha256: "a",
											lineCount: 1,
											oversizedLineCount: 0,
											parserVersion: state.parserVersion ?? 8,
											publishedAt: NOW.toISOString(),
											rowCount: state.records ?? 10,
											streamCount: 1,
											textTruncated: false,
											unparseableLineCount: 0,
										}),
									},
								];
					if (sql.includes("SELECT * EXCEPT")) {
						let committed: bigint[] | undefined;
						for (const row of fake.table)
							if (
								row.row_kind === "receipt" &&
								(!committed || newer(snapshotKey(row), committed))
							)
								committed = snapshotKey(row);
						const kind = statement.query_params?.kind;
						return fake.table.filter(
							(row) =>
								committed !== undefined &&
								!newer(snapshotKey(row), committed) &&
								!newer(committed, snapshotKey(row)) &&
								(kind === undefined || row.row_kind === kind),
						);
					}
					if (sql.includes("needsAuthMcpServers")) return state.mcpStates ?? [];
					if (sql.includes("shell_calls")) return state.directories ?? [];
					if (sql.includes("AS evidence")) return state.evidence ?? [];
					if (sql.includes("receipt_generation"))
						return [usage.length > 1 ? usage.shift() : usage[0]];
					if (sql.includes("codex_streams")) return state.runs ?? [];
					if (sql.includes("request_ranges")) return state.requests ?? [];
					if (sql.includes("unattributed_models")) {
						const current = usage[0] ?? CONSISTENT;
						return [
							unattributed(
								runIndexUsage(current).state === "consistent"
									? current.expected_events
									: 0,
							),
						];
					}
					if (sql.includes("cost_state_duration_ms"))
						return [
							{
								session_date_ms: String(
									state.sessionDateMs ?? NOW.getTime() - 3_600_000,
								),
								thread_source: "",
								title: "Fix the login",
								cost_state: { cost_usd: "1.25" },
								cost_state_duration_ms: 9000,
								has_cost_state: "1",
								calls: state.calls ?? [],
							},
						];
					if (sql.includes("session_analytics"))
						return [
							{
								repository: "github.com/acme/app",
								git_remote: state.gitRemote ?? "",
								project_path: "/repo",
								git_branch: "main",
								model: "opus",
							},
						];
					if (sql.includes("received_setup")) return state.setupRecords ?? [];
					if (sql.includes("build_text")) return state.snapshots ?? [];
					if (sql.includes("opening_prompt")) return state.messages ?? [];
					throw new Error(`unexpected statement: ${sql.slice(0, 80)}`);
				};
				return rows() as T[];
			},
		},
	};
	return fake;
}

const build = (
	fake: Fake,
	beforeWrite: () => Promise<void> = async () => {},
	buildRevision = 41,
) =>
	buildRunIndex({
		executor: fake.executor,
		organizationId: "org",
		session,
		buildRevision,
		beforeWrite: async () => {
			fake.events.push("fence");
			await beforeWrite();
		},
		now: () => NOW,
	});

describe("building a session's run index", () => {
	const runs = [
		facts({
			turn_idx: 1,
			start_record: 3,
			end_record: 9,
			tool_calls: 4,
			failed_calls: 1,
			l_denied_calls: 1,
			l_model: "claude-opus-5-5",
			l_models: ["claude-opus-5-5"],
			l_skills: ["ship-it"],
			prompt_head: "fix the login",
		}),
		facts({
			agent_id: "agent-a",
			turn_idx: 1,
			start_record: 1,
			end_record: 4,
			tool_calls: 2,
			l_models: ["claude-haiku-5-5"],
			l_skills: ["review"],
		}),
	];

	test("writes the runs, then the receipt that commits them, each behind the fence", async () => {
		const fake = fakeClickHouse({ runs });
		const result = await build(fake);
		expect(result).toMatchObject({ written: true, runCount: 2 });
		expect(fake.events).toEqual([
			"fence",
			"insert:runs",
			"fence",
			"insert:receipt",
		]);
		const [runInsert, receiptInsert] = fake.inserts;
		const prefix = `run-index:org:${encodeURIComponent("u/1")}/claude_code/${encodeURIComponent("s 1")}:7:8:${RUN_INDEX_VERSION}:41`;
		expect(runInsert?.token).toBe(`${prefix}:runs`);
		expect(receiptInsert?.token).toBe(`${prefix}:receipt`);
		// Run ids are the edges' ids: stream and the record that starts the run.
		expect(runInsert?.values.map((row) => row.run_id)).toEqual([
			runNodeId(session, "", 3),
			runNodeId(session, "agent-a", 1),
		]);
		expect(runInsert?.values[0]).toMatchObject({
			revision: "7",
			parser_version: 8,
			index_version: RUN_INDEX_VERSION,
			build_revision: "41",
			pricing_version: RUN_INDEX_PRICING_VERSION,
			start_record: 3,
			prompt_head: "fix the login",
			// Codex-only facts are unknown for Claude Code, not empty.
			approval_policy: null,
			goal: null,
			model: "claude-opus-5-5",
		});
		expect(runInsert?.values[0]?.unrecorded_facts).toContain("approval_policy");
		expect(receiptInsert?.values[0]).toMatchObject({
			row_kind: "receipt",
			agent_id: "",
			start_record: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
			build_revision: "41",
			run_count: 2,
			tool_calls: 6,
			failed_calls: 1,
			denied_calls: null,
			models: ["claude-haiku-5-5", "claude-opus-5-5"],
			skills: ["review", "ship-it"],
			usage_receipt: "12:abc",
			usage_observations: 2,
			cost_usd: 0.5,
			model_costs: [["claude-opus-5-5", 0.5, 1]],
			cost_state: { cost_usd: "1.25", duration_ms: "9000" },
			title: "Fix the login",
			repository: "github.com/acme/app",
			session_model: "opus",
			// Codex-only, so unknown for this session.
			thread_source: null,
		});
	});

	test("writes the requests after the runs and before the receipt, behind the fence, with their run's id and unknown usage as unknown", async () => {
		const request = (
			startRecord: number,
			overrides: Partial<RunRequestFactsRow> = {},
		): RunRequestFactsRow => ({
			agent_id: "",
			turn_idx: 1,
			run_start_record: 3,
			start_record: startRecord,
			end_record: startRecord + 2,
			started_ms: NOW.getTime(),
			ended_ms: NOW.getTime() + 60_000,
			calls: [[startRecord, 0, "Bash", "shell", "test", 1]],
			texts: 0,
			text_record: 0,
			text_block: 0,
			text_head: "",
			usage_observations: 1,
			usage_unpriced: 0,
			usage_model: "claude-opus-5-5",
			cost_usd: 0.5,
			uncached_input_tokens: "100",
			cache_read_input_tokens: "0",
			cache_write_5m_input_tokens: "0",
			cache_write_1h_input_tokens: "0",
			output_tokens: "10",
			reasoning_output_tokens: "0",
			...overrides,
		});
		const requests = [
			request(4),
			request(6, {
				calls: [],
				texts: 1,
				text_record: 7,
				text_block: 1,
				text_head: "done",
			}),
		];
		const fake = fakeClickHouse({ runs, requests });
		await build(fake);
		expect(fake.events).toEqual([
			"fence",
			"insert:runs",
			"fence",
			"insert:requests",
			"fence",
			"insert:receipt",
		]);
		expect(
			fake.requests.map((row) => [
				row.run_id,
				row.start_record,
				row.call_tools,
				row.call_failed,
				row.text_record,
				row.text_block,
				row.text_head,
				row.output_tokens,
			]),
		).toEqual([
			[runNodeId(session, "", 3), 4, ["Bash"], [1], null, null, null, "10"],
			[runNodeId(session, "", 3), 6, [], [], 7, 1, "done", "10"],
		]);

		const unknown = fakeClickHouse({
			runs,
			requests,
			usage: [{ ...CONSISTENT, complete: 0, generation_events: 1 }],
		});
		await build(unknown);
		expect(unknown.requests[0]).toMatchObject({
			usage_observations: 0,
			cost_usd: null,
			output_tokens: null,
		});
		expect(unknown.requests[0]?.unrecorded_facts).toContain("output_tokens");
	});

	test("writes every call after the runs and before the receipt, with its run's id, behind the fence", async () => {
		const fake = fakeClickHouse({
			runs,
			calls: [
				callTuple({ turn_idx: 1, record_idx: 4, call_id: "a" }),
				callTuple({ turn_idx: 0, record_idx: 1, call_id: "b" }),
			],
		});
		await build(fake);
		expect(fake.events).toEqual([
			"fence",
			"insert:runs",
			"fence",
			"insert:calls",
			"fence",
			"insert:receipt",
		]);
		expect(
			fake.calls.map((row) => [row.call_id, row.run_id, row.index_version]),
		).toEqual([
			["a", runNodeId(session, "", 3), RUN_INDEX_VERSION],
			["b", "", RUN_INDEX_VERSION],
		]);
	});

	test("writes each run's received setup after the requests and before the receipt, named by setup file and version", async () => {
		const sha = "c".repeat(64);
		const record = (overrides: Record<string, unknown>) => ({
			agent_id: "",
			record_idx: 1,
			block_idx: 0,
			at_ms: NOW.getTime(),
			kind: "injected_context",
			file_path: "",
			setup: "",
			replayed: 0,
			environment: "",
			environment_clipped: 0,
			...overrides,
		});
		const fake = fakeClickHouse({
			runs,
			gitRemote: "git@github.com:acme/app.git",
			setupRecords: [
				record({
					kind: "meta",
					environment: JSON.stringify([
						{
							path: "attachment/session_context.attachment.context.gitStatus",
							ordinal: 0,
							value: "Status:\n M CLAUDE.md\n",
						},
					]),
				}),
				record({
					record_idx: 2,
					setup: JSON.stringify([
						{
							kind: "instructions",
							path: "/w/app/CLAUDE.md",
							name: "",
							cwd: "/w/app",
							sha256: sha,
							chars: 12,
						},
					]),
				}),
			],
		});
		await build(fake);
		expect(fake.events).toEqual([
			"fence",
			"insert:runs",
			"fence",
			"insert:setup",
			"fence",
			"insert:receipt",
		]);
		expect(fake.setup).toEqual([
			expect.objectContaining({
				run_id: runNodeId(session, "", 3),
				run_start_record: 3,
				index_version: RUN_INDEX_VERSION,
				build_revision: "41",
				setup_file: "repository:github.com/acme/app:CLAUDE.md",
				scope: "repository",
				path: "CLAUDE.md",
				version: sha,
				version_name: "cccccccccccc uncommitted by u/1",
				uncommitted: true,
				carried: true,
				received_record: 2,
			}),
		]);
	});

	test("every run carries the session's repository, as the receipt does", async () => {
		const fake = fakeClickHouse({ runs });
		await build(fake);
		expect(fake.inserts[0]?.values.map((row) => row.repository)).toEqual([
			"github.com/acme/app",
			"github.com/acme/app",
		]);
	});

	test("each run names the directory it worked in, and that directory's repository only where the session's records tie it", async () => {
		const shell = (
			agentId: string,
			cdTarget: string,
			calls: number,
			first: number,
		) => ({
			agent_id: agentId,
			turn_idx: 1,
			shell: 1,
			cd_target: cdTarget,
			recorded_cwd: "/Users/ana/launch",
			calls,
			first_record: first,
		});
		const evidence = (fields: Record<string, unknown>) => ({
			evidence: "call",
			agent_id: "",
			first_record: 4,
			cd_target: "",
			recorded_cwd: "/Users/ana/launch",
			command: "",
			output: "",
			...fields,
		});
		const directories = [
			shell("", "~/code/cli", 2, 4),
			shell("", "", 1, 3),
			shell("agent-a", "/Users/ana/code/scratch", 3, 12),
		];
		const pushed = evidence({
			cd_target: "~/code/cli",
			command: "cd ~/code/cli && git push",
			output: "To github.com:acme/cli.git",
		});
		const fake = fakeClickHouse({
			runs,
			parserVersion: 10,
			directories,
			evidence: [pushed, evidence({ evidence: "session_branch" })],
		});
		await build(fake);
		const pick = (row: RudelRunIndexRow | undefined) => ({
			repository: row?.repository,
			cwd: row?.cwd,
			cwd_repository: row?.cwd_repository,
			cwd_repository_basis: row?.cwd_repository_basis,
		});
		const [main, subagent] = fake.inserts[0]?.values ?? [];
		expect(pick(main)).toEqual({
			repository: "github.com/acme/app",
			cwd: "/Users/ana/code/cli",
			cwd_repository: "github.com/acme/cli",
			cwd_repository_basis: "transfer_remote",
		});
		// Nothing ties the scratch checkout: unknown, not the session's repository.
		expect(pick(subagent)).toEqual({
			repository: "github.com/acme/app",
			cwd: "/Users/ana/code/scratch",
			cwd_repository: null,
			cwd_repository_basis: "",
		});
		expect(main?.unrecorded_facts).not.toContain("cwd");
		expect(fake.inserts[1]?.values[0]).toMatchObject({
			cwd: null,
			cwd_repository: null,
			cwd_repository_basis: "",
		});

		// Before parser 9 the cwd of a call without a leading cd is not
		// recorded: the columns are unknown, and their statements are not read.
		const old = fakeClickHouse({ runs, directories, evidence: [pushed] });
		await build(old);
		const [oldMain] = old.inserts[0]?.values ?? [];
		expect(pick(oldMain)).toEqual({
			repository: "github.com/acme/app",
			cwd: null,
			cwd_repository: null,
			cwd_repository_basis: "",
		});
		expect(oldMain?.unrecorded_facts).toEqual(
			expect.arrayContaining(["cwd", "cwd_repository"]),
		);
	});

	test("not found is counted on Claude Code main streams and unknown on its subagent streams, which keep no tool results", async () => {
		const fake = fakeClickHouse({
			runs: runs.map((run) => ({ ...run, not_found: 2 })),
		});
		await build(fake);
		const [main, subagent] = fake.inserts[0]?.values ?? [];
		expect(main?.not_found).toBe(2);
		expect(main?.unrecorded_facts).not.toContain("not_found");
		expect(subagent?.not_found).toBeNull();
		expect(subagent?.unrecorded_facts).toContain("not_found");
	});

	test("a run lists the MCP servers its stream recorded as unavailable, and a stream without a record lists none", async () => {
		const fake = fakeClickHouse({
			runs,
			parserVersion: 12,
			mcpStates: [{ agent_id: "", turn_idx: "0", unavailable: ["linear"] }],
		});
		await build(fake);
		const [main, subagent] = fake.inserts[0]?.values ?? [];
		expect(main?.mcp_unavailable).toEqual(["linear"]);
		expect(subagent?.mcp_unavailable).toEqual([]);
		expect(main?.unrecorded_facts).not.toContain("mcp_unavailable");
	});

	test("a parser 5 generation keeps its counts and knows none of its facts", async () => {
		const fake = fakeClickHouse({ runs, parserVersion: 5 });
		await build(fake);
		const [run] = fake.inserts[0]?.values ?? [];
		expect(run).toMatchObject({
			tool_calls: 4,
			failed_calls: 1,
			// Claude Code's reading of a search's exit code came with parser 6.
			not_found: null,
			denied_calls: null,
			model: null,
			agent_version: null,
			facts_truncated: null,
		});
		expect(run?.unrecorded_facts).toContain("models");
		expect(fake.inserts[1]?.values[0]).toMatchObject({
			denied_calls: null,
			title: null,
			cost_state: {},
		});
	});

	test("a run keeps the word-list categories of its opening prompt and the message it ended with", async () => {
		const fake = fakeClickHouse({
			runs,
			messages: [
				{
					agent_id: "",
					turn_idx: 1,
					opening_prompt: "this still doesn't work, shit",
					final_message: "Done. The login form posts now.",
					final_message_cut: 0,
					system_prompt: 0,
				},
				{
					agent_id: "agent-a",
					turn_idx: 1,
					opening_prompt: null,
					final_message: null,
					final_message_cut: 0,
					system_prompt: 0,
				},
			],
		});
		await build(fake);
		const [main, subagent] = fake.inserts[0]?.values ?? [];
		expect(main).toMatchObject({
			prompt_reactions: ["negative", "swear"],
			final_message: "Done. The login form posts now.",
		});
		expect(subagent).toMatchObject({
			prompt_reactions: [],
			final_message: null,
		});
	});

	test("a run says whether its final message was kept whole and whether its stream had recorded the system prompt by then", async () => {
		const fake = fakeClickHouse({
			runs: [
				facts({ turn_idx: 1, start_record: 3, end_record: 9 }),
				facts({ turn_idx: 2, start_record: 10, end_record: 12 }),
				facts({ agent_id: "agent-a", turn_idx: 1, start_record: 1 }),
				facts({ agent_id: "agent-a", turn_idx: 2, start_record: 5 }),
			],
			messages: [
				// The main stream recorded its system prompt before the first prompt.
				{ agent_id: "", turn_idx: 0, system_prompt: 1 },
				{
					agent_id: "",
					turn_idx: 1,
					opening_prompt: "fix the login",
					final_message: "context ".repeat(250),
					final_message_cut: 1,
				},
				// The subagent's arrived only in its second run.
				{ agent_id: "agent-a", turn_idx: 1, opening_prompt: "review it" },
				{ agent_id: "agent-a", turn_idx: 2, system_prompt: 1 },
			].map((row) => ({
				opening_prompt: null,
				final_message: null,
				final_message_cut: 0,
				system_prompt: 0,
				...row,
			})),
		});
		await build(fake);
		expect(
			fake.inserts[0]?.values.map((row) => [
				row.agent_id,
				row.turn_idx,
				row.final_message_cut,
				row.system_prompt_recorded,
			]),
		).toEqual([
			["", 1, true, true],
			["", 2, false, true],
			["agent-a", 1, false, false],
			["agent-a", 2, false, true],
		]);
	});

	test("a committed snapshot of the same generation, pricing and usage is not rebuilt", async () => {
		const fake = fakeClickHouse({ runs });
		await build(fake);
		const written = fake.inserts.length;
		expect(await build(fake, undefined, 42)).toMatchObject({
			written: false,
			runCount: 2,
			input: { builtRevision: "41" },
		});
		expect(fake.inserts).toHaveLength(written);
	});

	test("late usage rebuilds the generation; a rebuild that dies before its receipt leaves the committed snapshot whole", async () => {
		const fake = fakeClickHouse({ runs });
		await build(fake);
		const committed = fake.table.filter((row) => row.build_revision === "41");
		const later: UsageState = {
			...CONSISTENT,
			generation: "13",
			checksum: "def",
		};
		const crashing = fakeClickHouse({
			runs,
			usage: [later],
			failReceipt: true,
			table: fake.table,
		});
		await expect(build(crashing, undefined, 42)).rejects.toThrow(
			"connection reset",
		);
		// Build 42's runs exist; readers still read build 41, all of it.
		expect(fake.table.some((row) => row.build_revision === "42")).toBe(true);
		const reader = await crashing.executor.query<RudelRunIndexRow>({
			query: "SELECT * EXCEPT (x) FROM run_index",
		});
		expect(reader).toEqual(committed);
		// The next attempt publishes build 43 and readers move to it.
		const retry = fakeClickHouse({ runs, usage: [later], table: fake.table });
		expect((await build(retry, undefined, 43)).written).toBe(true);
		const [receipt] = await retry.executor.query<RudelRunIndexRow>({
			query: "SELECT * EXCEPT (x) FROM run_index",
			query_params: { kind: "receipt" },
		});
		expect(receipt).toMatchObject({
			build_revision: "43",
			usage_receipt: "13:def",
		});
	});

	test("usage that changes while the build reads it is not published", async () => {
		const fake = fakeClickHouse({
			runs,
			usage: [CONSISTENT, { ...CONSISTENT, generation: "13", checksum: "def" }],
		});
		await expect(build(fake)).rejects.toBeInstanceOf(RunIndexUsageChangedError);
		expect(fake.inserts).toEqual([]);
	});

	test("an incomplete usage extraction is stored as unknown usage, never a partial set", async () => {
		const incomplete: UsageState = {
			...CONSISTENT,
			complete: 0,
			generation_events: 1,
		};
		const fake = fakeClickHouse({ runs, usage: [incomplete] });
		await build(fake);
		const [run] = fake.inserts[0]?.values ?? [];
		const receipt = fake.inserts[1]?.values[0];
		for (const row of [run, receipt]) {
			expect(row).toMatchObject({
				cost_usd: null,
				output_tokens: null,
				usage_observations: 0,
				model_costs: [],
			});
			expect(row?.unrecorded_facts).toEqual(
				expect.arrayContaining(["cost_usd", "usage_observations"]),
			);
		}
		expect(receipt?.usage_receipt).toBe("12:abc:incomplete");
	});

	test("text of an old session is written like any other: nothing expires by age", async () => {
		const fake = fakeClickHouse({
			runs,
			sessionDateMs: NOW.getTime() - 4_000 * 86_400_000,
		});
		await build(fake);
		expect(fake.inserts[0]?.values[0]).toMatchObject({
			prompt_head: expect.any(String),
			tool_calls: 4,
		});
		expect(fake.inserts[1]?.values[0]?.title).not.toBeNull();
	});

	test("an expired transcript keeps the stored runs", async () => {
		const fake = fakeClickHouse({ runs });
		await build(fake);
		const kept = fakeClickHouse({ committed: false, table: fake.table });
		expect(await build(kept, undefined, 42)).toMatchObject({
			written: false,
			frozenReason: "transcript expired; run index kept",
			runCount: 2,
		});
		const never = fakeClickHouse({ committed: false });
		expect(await build(never)).toMatchObject({
			written: false,
			frozenReason: null,
		});
		expect([...kept.inserts, ...never.inserts, ...kept.executed]).toEqual([]);
	});

	test("a session past the bound is frozen with its reason, not aggregated", async () => {
		const fake = fakeClickHouse({ runs, records: 200_001 });
		const result = await build(fake);
		expect(result.written).toBe(false);
		expect(result.frozenReason).toBe(
			"session has 200001 records, over the run index bound of 200000",
		);
		expect(fake.inserts).toEqual([]);
	});

	test("a fence found between the runs and the receipt stops before committing", async () => {
		const fake = fakeClickHouse({ runs });
		let checks = 0;
		await expect(
			build(fake, async () => {
				if (++checks === 2) throw new ClickHouseWriteFencedError();
			}),
		).rejects.toBeInstanceOf(ClickHouseWriteFencedError);
		expect(fake.events).toEqual(["fence", "insert:runs", "fence"]);
	});
});

describe("usage of a build", () => {
	test("a session's usage is none, one consistent extraction, or unknown", () => {
		expect(runIndexUsage(NO_USAGE)).toEqual({
			state: "none",
			generation: "0",
			events: 0,
			key: "",
		});
		expect(runIndexUsage(CONSISTENT)).toEqual({
			state: "consistent",
			generation: "12",
			events: 2,
			key: "12:abc",
		});
		for (const broken of [
			{ complete: 0 },
			{ receipt_deleted: 1 },
			{ generation_events: 1 },
		])
			expect(runIndexUsage({ ...CONSISTENT, ...broken })).toMatchObject({
				state: "unknown",
				generation: "0",
				key: "12:abc:incomplete",
			});
		expect(runIndexUsage({ ...NO_USAGE, active_events: 3 }).key).toBe(
			"unreceipted:3",
		);
	});

	test("runs plus unattributed usage must be the whole extraction", () => {
		const usage = runIndexUsage(CONSISTENT);
		const run = facts({
			usage_observations: 1,
			usage_unpriced: 0,
			cost_usd: 0.25,
			output_tokens: "3",
		});
		const rest = {
			...unattributed(2),
			usage_observations: 1,
			usage_unpriced: 1,
			cost_usd: 0.25,
			output_tokens: "2",
		};
		expect(() => assertUsageConserved([run], rest, usage)).not.toThrow();
		// A verified event outside every run that went missing.
		expect(() =>
			assertUsageConserved(
				[run],
				{ ...rest, usage_observations: 0, output_tokens: "0" },
				usage,
			),
		).toThrow("not conserved (observations, output_tokens)");
		// A set that is not the receipt's.
		expect(() =>
			assertUsageConserved([run], rest, { ...usage, events: 3 }),
		).toThrow("receipt event count");
	});
});

describe("retiring snapshots", () => {
	const minutesAgo = (minutes: number) => NOW.getTime() - minutes * 60_000;
	const snapshot = (
		revision: string,
		build: string,
		receiptMinutesAgo: number | null,
		writtenMinutesAgo = receiptMinutesAgo ?? 0,
	) => ({
		revision_text: revision,
		parser_version: 8,
		index_version: 1,
		build_text: build,
		receipts: receiptMinutesAgo === null ? 0 : 1,
		receipt_built_ms:
			receiptMinutesAgo === null ? 0 : minutesAgo(receiptMinutesAgo),
		written_ms: minutesAgo(writtenMinutesAgo),
	});
	const retire = (rows: ReturnType<typeof snapshot>[]) =>
		selectRetiredSnapshots(rows, { graceMs: 10 * 60_000, now: NOW }).map(
			(row) => `${row.revision}/${row.buildRevision}`,
		);

	test("generation 1 crashed after its runs, generation 2 committed, cleanup failed: the sweep finds it", () => {
		expect(
			retire([snapshot("2", "50", 30), snapshot("1", "49", null, 40)]),
		).toEqual(["1/49"]);
	});

	test("a superseded build of the same generation goes after the grace, never the committed one", () => {
		expect(retire([snapshot("2", "51", 5), snapshot("2", "50", 30)])).toEqual(
			[],
		);
		expect(retire([snapshot("2", "51", 20), snapshot("2", "50", 30)])).toEqual([
			"2/50",
		]);
	});

	test("a newer build in flight stays; one abandoned past the grace goes", () => {
		expect(
			retire([snapshot("2", "52", null, 1), snapshot("2", "51", 30)]),
		).toEqual([]);
		expect(
			retire([snapshot("2", "52", null, 30), snapshot("2", "51", 30)]),
		).toEqual(["2/52"]);
	});

	test("without any committed snapshot only abandoned builds go", () => {
		expect(
			retire([snapshot("2", "52", null, 30), snapshot("1", "40", null, 1)]),
		).toEqual(["2/52"]);
	});
});

describe("run index rows", () => {
	const context = {
		organizationId: "org",
		session,
		generation: { revision: "7", parserVersion: 8, indexVersion: 1 },
		buildRevision: 1,
		builtAt: "2026-10-08 12:00:00.000",
		sessionDate: "2026-10-08 11:00:00.000",
		repository: "",
	};

	test("a run's unavailable MCP servers are its stream's latest server-state record's, carried to later runs of that stream only", () => {
		const unavailable = carriedMcpUnavailable([
			// Recorded before the stream's first prompt.
			{ agent_id: "", turn_idx: 0, unavailable: ["claude.ai Gmail", "linear"] },
			// A later record lists one server fewer: the person signed in.
			{ agent_id: "", turn_idx: 3, unavailable: ["linear"] },
			{ agent_id: "a2", turn_idx: 1, unavailable: [] },
		]);
		expect(
			[
				["", 1],
				["", 2],
				["", 3],
				["", 4],
				// A subagent stream reads its own records, never the main stream's.
				["a1", 1],
				["a2", 1],
			].map(([agent, turn]) =>
				unavailable({ agent_id: String(agent), turn_idx: Number(turn) }),
			),
		).toEqual([
			["claude.ai Gmail", "linear"],
			["claude.ai Gmail", "linear"],
			["linear"],
			["linear"],
			[],
			[],
		]);
		expect(
			runRow(facts(), NO_CODEX_LIFECYCLE_FACTS, context, undefined, undefined, [
				"linear",
			]).mcp_unavailable,
		).toEqual(["linear"]);
	});

	test("flags say true when any record says so, false only when all say false, empty when none says", () => {
		const row = (overrides: Partial<RunIndexFactsRow>) =>
			runRow(facts(overrides), NO_CODEX_LIFECYCLE_FACTS, context);
		expect(row({ l_aborted_false: 2, l_aborted_true: 1 }).aborted).toBe("true");
		expect(row({ l_aborted_false: 2 }).aborted).toBe("false");
		expect(row({}).aborted).toBe("");
		expect(row({ l_prevented_false: 1 }).prevented_continuation).toBe("false");
		expect(
			runRow(facts(), { ...NO_CODEX_LIFECYCLE_FACTS, abortedTrue: 1 }, context)
				.aborted,
		).toBe("true");
	});

	test("Claude abort reason and Codex turn effort survive row materialization", () => {
		expect(
			runRow(
				facts({ l_abort_reason: "[Request interrupted by user]" }),
				NO_CODEX_LIFECYCLE_FACTS,
				context,
			).abort_reason,
		).toBe("[Request interrupted by user]");
		const codex = {
			...context,
			session: { ...context.session, source: "codex" },
		};
		expect(
			runRow(
				facts({ l_effort: "low" }),
				{ ...NO_CODEX_LIFECYCLE_FACTS, effort: "high" },
				codex,
			).per_turn_effort,
		).toBe("high");
		expect(
			runRow(facts({ l_effort: "low" }), NO_CODEX_LIFECYCLE_FACTS, codex)
				.per_turn_effort,
		).toBe("low");
	});

	test("hook lists stay JSON arrays in record order; none recorded is empty, not an empty array", () => {
		const row = runRow(
			facts({
				l_hook_errors: ['"lint failed"', '{"code":1}'],
				l_hook_summaries: 2,
				l_hook_count: 3,
			}),
			NO_CODEX_LIFECYCLE_FACTS,
			context,
		);
		expect(row.hook_errors).toBe('["lint failed",{"code":1}]');
		expect(JSON.parse(row.hook_errors ?? "")).toEqual([
			"lint failed",
			{ code: 1 },
		]);
		expect(row.hook_runs).toBe("");
		expect(row.hook_count).toBe(3);
		expect(
			runRow(facts(), NO_CODEX_LIFECYCLE_FACTS, context).hook_count,
		).toBeNull();
	});

	test("a prompt's origin is native only when a native field is recorded", () => {
		expect(
			runRow(facts(), NO_CODEX_LIFECYCLE_FACTS, context).prompt_origin_basis,
		).toBe("wrapper");
		expect(
			runRow(
				facts({ l_prompt_source: "typed" }),
				NO_CODEX_LIFECYCLE_FACTS,
				context,
			).prompt_origin_basis,
		).toBe("native");
		expect(
			runRow(
				facts({ thread_source: "subagent" }),
				NO_CODEX_LIFECYCLE_FACTS,
				context,
			).prompt_origin_basis,
		).toBe("native");
	});

	test("who approved a run's calls is counted, and unknown when none of its results records a decision", () => {
		const claude = {
			...context,
			generation: { ...context.generation, parserVersion: 12 },
		};
		const counted = facts({
			l_approvals_by_user: 2,
			l_approvals_by_hook: 1,
			l_approvals_by_config: 40,
			l_permission_prompts: 3,
		});
		expect(
			gateRunIndexRow(runRow(counted, NO_CODEX_LIFECYCLE_FACTS, claude), {
				unknown: runUnknownColumns(counted),
			}),
		).toMatchObject({
			approvals_by_user: 2,
			approvals_by_hook: 1,
			approvals_by_config: 40,
			permission_prompts: 3,
		});
		// A Claude Code version that writes no permissionDecision.
		const silent = facts({ l_permissions_unrecorded: 1 });
		const unknown = gateRunIndexRow(
			runRow(silent, NO_CODEX_LIFECYCLE_FACTS, claude),
			{ unknown: runUnknownColumns(silent) },
		);
		expect(unknown).toMatchObject({
			approvals_by_user: null,
			approvals_by_hook: null,
			approvals_by_config: null,
			permission_prompts: null,
		});
		expect(unknown.unrecorded_facts).toEqual(
			expect.arrayContaining([
				"approvals_by_config",
				"approvals_by_hook",
				"approvals_by_user",
				"permission_prompts",
			]),
		);
		// Codex persists no per-call decision: unknown on every run.
		const codex = gateRunIndexRow(
			runRow(counted, NO_CODEX_LIFECYCLE_FACTS, {
				...claude,
				session: { ...session, source: "codex" },
			}),
		);
		expect(codex.approvals_by_user).toBeNull();
		expect(codex.unrecorded_facts).toContain("permission_prompts");
	});

	test("a run's rate limits and efforts come from its records and its Codex lifecycle rows", () => {
		const codex = {
			...context,
			generation: { ...context.generation, parserVersion: 12 },
			session: { ...session, source: "codex" },
		};
		const row = gateRunIndexRow(
			runRow(
				facts({ l_rate_limit_max_used_percent: 97.5, l_efforts: [] }),
				{
					...NO_CODEX_LIFECYCLE_FACTS,
					effort: "xhigh",
					efforts: ["low", "xhigh"],
					usageLimited: true,
				},
				codex,
			),
		);
		expect(row).toMatchObject({
			effort: "xhigh",
			efforts: ["low", "xhigh"],
			rate_limit_max_used_percent: 97.5,
			rate_limited: true,
		});
		const claude = gateRunIndexRow(
			runRow(
				facts({
					l_rate_limited: 1,
					l_rate_limit_max_used_percent: null,
					l_effort: "high",
					l_efforts: ["high", "medium"],
				}),
				NO_CODEX_LIFECYCLE_FACTS,
				{ ...codex, session },
			),
		);
		expect(claude).toMatchObject({
			effort: "high",
			efforts: ["high", "medium"],
			rate_limited: true,
			rate_limit_max_used_percent: null,
		});
		// Claude Code reports no share of a window used.
		expect(claude.unrecorded_facts).toContain("rate_limit_max_used_percent");
		expect(
			gateRunIndexRow(runRow(facts(), NO_CODEX_LIFECYCLE_FACTS, codex))
				.rate_limited,
		).toBe(false);
	});

	test("Codex lifecycle facts fill the run; the usage of a run without usage stays unknown", () => {
		const row = runRow(
			facts({ l_models: [] }),
			{
				...NO_CODEX_LIFECYCLE_FACTS,
				model: "gpt-6",
				models: ["gpt-6"],
				durationMs: 2272,
				timeToFirstTokenMs: "1941",
				contextWindow: "258400",
			},
			{ ...context, session: { ...session, source: "codex" } },
		);
		expect(row).toMatchObject({
			model: "gpt-6",
			models: ["gpt-6"],
			duration_ms: 2272,
			time_to_first_token_ms: 1941,
			context_window: 258400,
			cost_usd: null,
			output_tokens: null,
			usage_observations: 0,
		});
	});
});

describe("run index statements", () => {
	const generation = {
		sessionId: "s 1",
		revision: "7",
		parserVersion: 8,
		usageGeneration: "12",
	};
	const finalScans = (query: string) =>
		query.match(/rudel\.transcript_records FINAL/gu)?.length ?? 0;

	test("runs start where the edges' runs start, from one deduplicated scan", () => {
		const statement = buildRunIndexStatement(scope, generation);
		expect(finalScans(statement.query)).toBe(1);
		// The edges' run start: min(record_idx) of the generation's records of
		// the run (turn_idx >= 1), receipt excluded.
		expect(statement.query).toContain("min(record_idx) AS first_record");
		expect(statement.query).toContain("r.first_record AS start_record");
		expect(statement.query).toMatch(
			/FROM rudel\.transcript_records FINAL WHERE [\s\S]*?AND turn_idx >= 1/u,
		);
		expect(statement.query_params).toMatchObject({
			sessionIds: ["s 1"],
			revisions: ["7"],
			parserVersions: [8],
			usageGeneration: "12",
		});
	});

	test("the index prices one usage extraction; find reads every active event", () => {
		const index = buildRunIndexStatement(scope, generation).query;
		expect(index).toContain("e.event_version = {usageGeneration:UInt64}");
		expect(index).toContain(
			"duplicate_observation_count = 0 AND event_version = {usageGeneration:UInt64}",
		);
		expect(buildRunFactsStatement(scope, [generation]).query).not.toContain(
			"usageGeneration",
		);
	});

	test("unattributed usage is every event no run claims, verified or not", () => {
		const statement = buildUnattributedUsageStatement(scope, generation);
		expect(statement.query).toContain("FROM unassigned_usage e");
		expect(statement.query).not.toContain("e.verified = 0");
		expect(statement.query).toContain("CROSS JOIN whole t");
		// find reports the same unassigned usage per session.
		expect(buildRunFactsStatement(scope, [generation]).query).toContain(
			"FROM unassigned_usage e GROUP BY session_id, usage_model",
		);
	});

	test("find shares the run CTEs but not the literal facts", () => {
		const find = buildRunFactsStatement(scope, [generation]).query;
		const index = buildRunIndexStatement(scope, generation).query;
		const span = (query: string) =>
			query.slice(
				query.indexOf("run_facts AS ("),
				query.indexOf("countIf(kind = 'tool_call') AS tool_calls"),
			);
		expect(span(index)).toBe(span(find));
		expect(find).not.toContain("l_agent_version");
		expect(index).toContain("l_agent_version");
	});
});

describe("generic generation retirement", () => {
	const minutesAgo = (minutes: number) => NOW.getTime() - minutes * 60_000;

	test("uncommitted generations go at once; committed ones after the grace since they were superseded", () => {
		expect(
			selectRetiredGenerations(
				[
					{ generation: "b", publishedAtMs: minutesAgo(30) },
					{ generation: "a", publishedAtMs: null },
					{ generation: "z", publishedAtMs: minutesAgo(60) },
				],
				{ graceMs: 10 * 60_000, now: NOW, publishedAtMs: minutesAgo(1) },
			),
		).toEqual(["a", "z"]);
	});

	test("an unreadable publication time keeps everything below it", () => {
		expect(
			selectRetiredGenerations(
				[
					{ generation: "b", publishedAtMs: Number.NaN },
					{ generation: "a", publishedAtMs: minutesAgo(60) },
				],
				{ graceMs: 10 * 60_000, now: NOW, publishedAtMs: minutesAgo(30) },
			),
		).toEqual(["b"]);
	});
});
