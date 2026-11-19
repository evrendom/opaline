import "./helpers/local-integration-guard.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { type ClickHouseStatement, getClickhouse } from "../clickhouse.js";
import {
	buildRunIndexSessionStatement,
	buildRunIndexStatement,
	buildRunRequestsStatement,
	buildUnattributedUsageStatement,
} from "../services/analysis/run-index-sql.js";
import {
	callFactsCtes,
	callTuplesSql,
} from "../services/l1-edges/call-facts.js";
import {
	readCommittedGenerations,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../services/transcript-generations/generations.js";
import {
	buildMapCommandsStatement,
	buildMapFilesStatement,
	buildMapPromptsStatement,
	buildMapTurnsStatement,
	buildRecordBlocksStatement,
	buildRecordSliceStatement,
	buildSessionCommandsStatement,
	buildSessionFilesStatement,
	buildSessionTotalsStatement,
	buildTurnActionsStatement,
	buildTurnDiffStatement,
	buildTurnFailuresStatement,
	buildTurnFileChangesStatement,
	buildTurnParentCommandsStatement,
	buildTurnPromptStatement,
	buildTurnRawStatement,
} from "../services/transcript-records-queries.js";

const clickhouse = getClickhouse();
const stored: TranscriptReadScope = {
	organizationId: `readers-${crypto.randomUUID()}`,
	userId: "member",
};
const committedOnly: TranscriptReadScope = {
	organizationId: `readers-committed-${crypto.randomUUID()}`,
	userId: "member",
};
const committedWithReceipt: TranscriptReadScope = {
	organizationId: `readers-receipt-${crypto.randomUUID()}`,
	userId: "member",
};
const SESSION = "session";
const RECEIPT = TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX;
const TS = "2026-11-16 10:00:00.000";

function content(scope: TranscriptReadScope, revision: string, marker: string) {
	const base = {
		organization_id: scope.organizationId,
		user_id: scope.userId,
		session_id: SESSION,
		source: "claude_code",
		agent_id: "",
		revision,
		parser_version: 8,
		block_idx: 0,
		turn_idx: 1,
		ts: TS,
		session_date: TS,
	};
	return [
		{
			...base,
			record_idx: 1,
			kind: "user_prompt",
			head: `prompt ${marker}`,
			text: `prompt ${marker}`,
			text_chars: 7 + marker.length,
		},
		{
			...base,
			record_idx: 2,
			kind: "tool_call",
			tool_name: "Bash",
			command_class: "test",
			call_id: `test-${marker}`,
			head: `bun test ${marker}`,
			text: `bun test ${marker}`,
		},
		{
			...base,
			record_idx: 3,
			kind: "tool_result",
			tool_name: "Bash",
			command_class: "test",
			call_id: `test-${marker}`,
			is_error: true,
			exit_code: 1,
			tail: `failed ${marker}`,
		},
		{
			...base,
			record_idx: 4,
			kind: "tool_call",
			tool_name: "Bash",
			call_id: "edit",
			head: `sed -i ${marker}`,
			text: `sed -i ${marker}`,
		},
		{
			...base,
			record_idx: 5,
			kind: "file_change",
			file_op: "write",
			file_path: `src/${marker}.ts`,
			call_id: "edit",
			text: `diff ${marker}`,
		},
		{
			...base,
			record_idx: 6,
			kind: "tool_call",
			tool_name: "Task",
			spawned_agent_id: `agent-${marker}`,
			head: `task ${marker}`,
		},
	];
}

function receipt(scope: TranscriptReadScope, revision: string) {
	return {
		organization_id: scope.organizationId,
		user_id: scope.userId,
		session_id: SESSION,
		source: "claude_code",
		agent_id: "",
		revision,
		parser_version: 8,
		record_idx: RECEIPT,
		block_idx: 0,
		turn_idx: 0,
		ts: TS,
		session_date: TS,
		kind: "receipt",
		head: `receipt ${revision}`,
		text: `receipt ${revision}`,
	};
}

beforeAll(async () => {
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...content(stored, "10", "superseded"),
			receipt(stored, "10"),
			...content(stored, "20", "committed"),
			receipt(stored, "20"),
			...content(stored, "30", "crashed"),
			...content(committedOnly, "20", "committed"),
			...content(committedWithReceipt, "20", "committed"),
			receipt(committedWithReceipt, "20"),
		],
	});
});

afterAll(async () => {
	await clickhouse.execute({
		query:
			"DELETE FROM rudel.transcript_records WHERE organization_id IN {organizationIds:Array(String)}",
		query_params: {
			organizationIds: [
				stored.organizationId,
				committedOnly.organizationId,
				committedWithReceipt.organizationId,
			],
		},
		clickhouse_settings: { lightweight_deletes_sync: "1" },
	});
});

type Build = (
	scope: TranscriptReadScope,
	generation: SessionGeneration,
) => ClickHouseStatement;

const readers: [string, Build][] = [
	["session totals", (s, g) => buildSessionTotalsStatement(s, [g])],
	["session commands", (s, g) => buildSessionCommandsStatement(s, [g])],
	["session files", (s, g) => buildSessionFilesStatement(s, [g], 10)],
	["map turns", (s, g) => buildMapTurnsStatement(s, g, "")],
	["map prompts", (s, g) => buildMapPromptsStatement(s, g, "")],
	["map files", (s, g) => buildMapFilesStatement(s, g, "", 10)],
	["map commands", (s, g) => buildMapCommandsStatement(s, g, "")],
	["turn prompt", (s, g) => buildTurnPromptStatement(s, g, "", 1, 100)],
	["turn actions", (s, g) => buildTurnActionsStatement(s, g, "", 1, 10, 100)],
	[
		"turn file changes",
		(s, g) => buildTurnFileChangesStatement(s, g, "", 1, 10),
	],
	["turn failures", (s, g) => buildTurnFailuresStatement(s, g, "", 1, 10)],
	["turn diff", (s, g) => buildTurnDiffStatement(s, g, "", 1, 10, 100)],
	[
		"turn parent commands",
		(s, g) => buildTurnParentCommandsStatement(s, g, "", 1, ["edit"], 100),
	],
	["turn raw", (s, g) => buildTurnRawStatement(s, g, "", 1, 10, 100)],
	["record blocks", (s, g) => buildRecordBlocksStatement(s, g, "", 2)],
	["record slice", (s, g) => buildRecordSliceStatement(s, g, "", 2, 0, 0, 100)],
];

const usageBound = (generation: SessionGeneration) => ({
	...generation,
	usageGeneration: "0",
	source: "claude_code",
});

const runIndexReaders: [string, Build][] = [
	["run index runs", (s, g) => buildRunIndexStatement(s, usageBound(g))],
	["run index requests", (s, g) => buildRunRequestsStatement(s, usageBound(g))],
	[
		"run index unattributed usage",
		(s, g) => buildUnattributedUsageStatement(s, usageBound(g)),
	],
];

const sessionFacts: Build = (s, g) =>
	buildRunIndexSessionStatement(s, g, {
		ctes: callFactsCtes(),
		sql: callTuplesSql(),
	});

const receiptProbes: [string, Build][] = [
	["turn raw of turn 0", (s, g) => buildTurnRawStatement(s, g, "", 0, 10, 100)],
	[
		"turn prompt of turn 0",
		(s, g) => buildTurnPromptStatement(s, g, "", 0, 100),
	],
	[
		"record blocks of the receipt",
		(s, g) => buildRecordBlocksStatement(s, g, "", RECEIPT),
	],
	[
		"record slice of the receipt",
		(s, g) => buildRecordSliceStatement(s, g, "", RECEIPT, 0, 0, 100),
	],
];

async function rows(statement: ClickHouseStatement) {
	return clickhouse.query<Record<string, unknown>>(statement);
}

async function committed(): Promise<SessionGeneration> {
	const [generation] = await readCommittedGenerations(clickhouse, stored, [
		SESSION,
	]);
	if (!generation) throw new Error("no committed generation");
	return {
		sessionId: generation.sessionId,
		revision: generation.revision,
		parserVersion: generation.parserVersion,
	};
}

describe("transcript record readers", () => {
	test("the committed generation is the newest receipt, not the newer crashed build", async () => {
		expect(await committed()).toEqual({
			sessionId: SESSION,
			revision: "20",
			parserVersion: 8,
		});
	});

	test.each(
		readers,
	)("%s reads only the committed generation and no receipt", async (_name, build) => {
		const generation = await committed();
		const expected = await rows(build(committedOnly, generation));
		expect(expected.length).toBeGreaterThan(0);
		expect(await rows(build(stored, generation))).toEqual(expected);
	});

	test.each(
		runIndexReaders,
	)("%s reads only the committed generation and no receipt", async (_name, build) => {
		const generation = await committed();
		expect(await rows(build(stored, generation))).toEqual(
			await rows(build(committedOnly, generation)),
		);
	});

	test("the run index session facts and calls read the committed generation and only its receipt", async () => {
		const generation = await committed();
		const expected = await rows(sessionFacts(committedWithReceipt, generation));
		expect(expected[0]?.session_date_ms).toBe(
			Date.parse("2026-11-16T10:00:00Z"),
		);
		expect(await rows(sessionFacts(stored, generation))).toEqual(expected);
	});

	test.each(receiptProbes)("%s returns no receipt", async (_name, build) => {
		expect(await rows(build(stored, await committed()))).toEqual([]);
	});
});
