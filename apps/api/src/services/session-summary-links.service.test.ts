import { describe, expect, test } from "bun:test";
import {
	SessionSetupRunsSchema,
	SessionSetupTextSchema,
} from "@rudel/api-routes";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	sessionSetupRuns,
	sessionSetupText,
} from "./session-summary-links.service.js";

function executorOf(rows: readonly Record<string, unknown>[]) {
	const statements: ClickHouseStatement[] = [];
	const executor = {
		statements,
		async close() {},
		async execute() {},
		async query<T>(statement: ClickHouseStatement) {
			statements.push(statement);
			return rows as T[];
		},
		async insert() {},
	};
	return executor satisfies ClickHouseExecutor & {
		statements: ClickHouseStatement[];
	};
}

const ms = (iso: string) => Date.parse(iso);

const SESSION = "f25de7b7-f1c9-4fd8-9141-245cc6e73d24";
const MEMBER = "sELOs7w9GGmFsw73PlyMbAjdWUQuTS5T";
const SCOPE = { workspaceId: "w", member: MEMBER };
const SYSTEM_PROMPT = "harness:claude_code:system_prompt";

// Session f25de7b7-…'s harness system prompt as stored in prod: three texts,
// the main stream's first and two subagents' (texts shortened here). UInt64
// and Int64 arrive quoted, as ClickHouse's JSON formats write them.
const row = (over: Record<string, unknown>) => ({
	version: "f042871f58ae84de480a4a8d936ad09efbfe8d46dabf2e93316cb48324522de6",
	version_name: "f042871f58ae",
	chars: 1603,
	runs: "38",
	first_ms: String(ms("2026-10-16T09:28:16.151Z")),
	text: "\nYou are an agent working with the user toward their goals",
	text_cut: 0,
	...over,
});
const PROD_ROWS = [
	row({}),
	row({
		version: "40e32d086053e6330806075b7b7915848e51712001179416af6655522379a602",
		version_name: "40e32d086053",
		chars: 2720,
		runs: "19",
		first_ms: String(ms("2026-10-16T09:34:49.168Z")),
		text: "You are an agent for Claude Code, Anthropic's official CLI for Claude.",
	}),
	row({
		version: "17148e07c55db626aa66f1486ac60c65bea17daac38e4a7f4c0c95dae462f238",
		version_name: "17148e07c55d",
		chars: 3263,
		runs: "1",
		first_ms: String(ms("2026-10-16T09:36:14.379Z")),
		text: "You are a file search specialist for Claude Code",
		text_cut: 1,
	}),
];

describe("sessionSetupText", () => {
	test("gives each stored text of the setup file, read latest first, oldest first as the contract's versions", async () => {
		const executor = executorOf([...PROD_ROWS].reverse());
		const result = await sessionSetupText(
			{ executor },
			SCOPE,
			SESSION,
			SYSTEM_PROMPT,
		);
		expect(SessionSetupTextSchema.parse(result)).toEqual(result);
		expect(result.versions).toEqual([
			{
				version:
					"f042871f58ae84de480a4a8d936ad09efbfe8d46dabf2e93316cb48324522de6",
				versionName: "f042871f58ae",
				text: "\nYou are an agent working with the user toward their goals",
				textCut: false,
				chars: 1603,
				runs: 38,
				firstAt: "2026-10-16T09:28:16.151Z",
			},
			{
				version:
					"40e32d086053e6330806075b7b7915848e51712001179416af6655522379a602",
				versionName: "40e32d086053",
				text: "You are an agent for Claude Code, Anthropic's official CLI for Claude.",
				textCut: false,
				chars: 2720,
				runs: 19,
				firstAt: "2026-10-16T09:34:49.168Z",
			},
			{
				version:
					"17148e07c55db626aa66f1486ac60c65bea17daac38e4a7f4c0c95dae462f238",
				versionName: "17148e07c55d",
				text: "You are a file search specialist for Claude Code",
				textCut: true,
				chars: 3263,
				runs: 1,
				firstAt: "2026-10-16T09:36:14.379Z",
			},
		]);
	});

	test("reads one setup file of the session's committed build, joined to the owner's stored texts", async () => {
		const executor = executorOf([]);
		expect(
			await sessionSetupText({ executor }, SCOPE, SESSION, SYSTEM_PROMPT),
		).toEqual({ versions: [] });
		expect(executor.statements).toHaveLength(1);
		const [statement] = executor.statements;
		expect(statement?.query_params).toEqual({
			workspaceId: "w",
			sessionId: SESSION,
			member: MEMBER,
			setupFile: SYSTEM_PROMPT,
		});
		const sql = statement?.query ?? "";
		expect(sql).toContain("FROM rudel.run_setup FINAL");
		expect(sql).toContain("FROM rudel.setup_texts FINAL");
		expect(sql).toContain(
			"organization_id = {workspaceId:String} AND session_id = {sessionId:String} AND user_id = {member:String} AND setup_file = {setupFile:String}",
		);
		expect(sql).toContain("FROM rudel.run_index");
		expect(sql).toContain("row_kind = 'receipt'");
		expect(sql).toContain("INNER JOIN");
		expect(sql).toContain("t.user_id = r.user_id AND t.version = r.version");
		expect(sql).toContain("ORDER BY first_ms DESC, version DESC");
		expect(sql).toContain("LIMIT 24");
		expect(statement?.clickhouse_settings).toMatchObject({
			max_execution_time: 30,
		});
	});

	test("reads every member's session rows when the reader isn't limited to the owner's", async () => {
		const executor = executorOf([]);
		await sessionSetupText(
			{ executor },
			{ workspaceId: "w", member: null },
			SESSION,
			SYSTEM_PROMPT,
		);
		const [statement] = executor.statements;
		expect(statement?.query_params).toEqual({
			workspaceId: "w",
			sessionId: SESSION,
			setupFile: SYSTEM_PROMPT,
		});
		expect(statement?.query).not.toContain("{member:String}");
	});
});

describe("sessionSetupRuns", () => {
	// A main run that had the system prompt carried in, and a subagent's run
	// that received it during the run after a compaction. Int64 and Bool
	const RUN_ROWS = [
		{
			agent_id: "",
			started_ms: String(ms("2026-10-16T09:28:16.151Z")),
			setup_file: SYSTEM_PROMPT,
			version: "f042871f58ae84de",
			version_name: "f042871f58ae",
			carried: 1,
			compacted: 0,
		},
		{
			agent_id: "a3f9c2d1e0b4",
			started_ms: String(ms("2026-10-16T09:34:49.168Z")),
			setup_file: SYSTEM_PROMPT,
			version: "40e32d086053e633",
			version_name: "40e32d086053 uncommitted by member",
			carried: 0,
			compacted: 1,
		},
	];

	test("gives each run's setup file version as the contract's runs", async () => {
		const executor = executorOf(RUN_ROWS);
		const result = await sessionSetupRuns({ executor }, SCOPE, SESSION);
		expect(SessionSetupRunsSchema.parse(result)).toEqual(result);
		expect(result.runs).toEqual([
			{
				agentId: "",
				startedAt: "2026-10-16T09:28:16.151Z",
				setupFile: SYSTEM_PROMPT,
				version: "f042871f58ae84de",
				versionName: "f042871f58ae",
				carried: true,
				compacted: false,
			},
			{
				agentId: "a3f9c2d1e0b4",
				startedAt: "2026-10-16T09:34:49.168Z",
				setupFile: SYSTEM_PROMPT,
				version: "40e32d086053e633",
				versionName: "40e32d086053 uncommitted by member",
				carried: false,
				compacted: true,
			},
		]);
	});

	test("reads the session's committed build only, ordered by when the runs started", async () => {
		const executor = executorOf([]);
		expect(await sessionSetupRuns({ executor }, SCOPE, SESSION)).toEqual({
			runs: [],
		});
		expect(executor.statements).toHaveLength(1);
		const [statement] = executor.statements;
		expect(statement?.query_params).toEqual({
			workspaceId: "w",
			sessionId: SESSION,
			member: MEMBER,
		});
		const sql = statement?.query ?? "";
		expect(sql).toContain("FROM rudel.run_setup FINAL");
		expect(sql).toContain(
			"organization_id = {workspaceId:String} AND session_id = {sessionId:String} AND user_id = {member:String}",
		);
		expect(sql).toContain("FROM rudel.run_index");
		expect(sql).toContain("row_kind = 'receipt'");
		expect(sql).toContain(
			"ORDER BY run_started_at, agent_id, run_start_record",
		);
		expect(sql).not.toContain("SETTINGS");
		expect(statement?.clickhouse_settings).toMatchObject({
			max_execution_time: 30,
		});
	});

	test("reads every member's session rows when the reader isn't limited to the owner's", async () => {
		const executor = executorOf([]);
		await sessionSetupRuns(
			{ executor },
			{ workspaceId: "w", member: null },
			SESSION,
		);
		const [statement] = executor.statements;
		expect(statement?.query_params).toEqual({
			workspaceId: "w",
			sessionId: SESSION,
		});
		expect(statement?.query).not.toContain("{member:String}");
	});
});
