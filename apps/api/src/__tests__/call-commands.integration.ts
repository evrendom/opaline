import "./helpers/local-integration-guard.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AnalysisFindInput } from "@rudel/api-routes";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import {
	ensureCallCommands,
	missingCallCommandGenerations,
} from "../services/analysis/call-commands.js";
import {
	buildCallExamplesStatement,
	buildCallGroupsStatement,
	buildCallRowsStatement,
	type CallGroupBy,
} from "../services/analysis/call-queries.js";
import {
	type CommandRecord,
	MERGE,
	NEAR_DUPLICATES,
	PROGRAMS,
	SEPARATE,
} from "./helpers/command-identity-cases.js";

const clickhouse = getClickhouse();
const organizationId = `call-commands-${crypto.randomUUID()}`;
const scope = { organizationId, userId: "member" };
const generations = [
	{ sessionId: "s1", revision: "7", parserVersion: 15 },
	{ sessionId: "s2", revision: "9", parserVersion: 15 },
];

const cases: CommandRecord[] = [
	...MERGE.flatMap(([, records]) => records),
	...SEPARATE.flatMap(([, records]) => records),
	...PROGRAMS.map(([record]) => record),
	...NEAR_DUPLICATES,
];

function row(
	sessionId: string,
	revision: string,
	recordIdx: number,
	values: Record<string, unknown>,
) {
	return {
		organization_id: organizationId,
		user_id: scope.userId,
		session_id: sessionId,
		source: "claude_code",
		agent_id: recordIdx % 5 === 0 ? "agent-a" : "",
		revision,
		record_idx: recordIdx,
		block_idx: 0,
		turn_idx: 1 + (recordIdx % 3),
		ts: new Date(Date.UTC(2026, 10, 9, 10, 0, recordIdx))
			.toISOString()
			.replace("T", " ")
			.replace("Z", ""),
		session_date: "2026-11-09 10:00:00.000",
		kind: "tool_call",
		subtype: "",
		tool_name: "Bash",
		command_class: "",
		is_error: false,
		exit_code: null,
		call_id: `call-${recordIdx}`,
		file_path: "",
		file_op: "",
		spawned_agent_id: "",
		byte_start: 0,
		byte_len: 0,
		text_chars: 0,
		parser_version: 15,
		head: "",
		tail: "",
		text: "",
		...values,
	};
}

beforeAll(async () => {
	const values: object[] = [];
	for (const [index, generation] of generations.entries()) {
		let recordIdx = 0;
		for (const record of cases) {
			recordIdx += 2;
			const cut = recordIdx % 7 === 0;
			values.push(
				row(generation.sessionId, generation.revision, recordIdx, {
					kind: record.kind ?? "tool_call",
					subtype: record.subtype ?? "",
					tool_name: record.tool ?? "Bash",
					file_path: record.filePath ?? "",
					file_op: record.kind === "file_change" ? "write" : "",
					parser_version: 15,
					text: cut ? record.text.slice(0, 20) : record.text,
					head: record.text.slice(0, 40),
					text_chars: [...record.text].length + (cut ? 5 : 0),
				}),
				row(generation.sessionId, generation.revision, recordIdx + 1, {
					kind: "tool_result",
					tool_name: "",
					is_error: recordIdx % 3 === 0,
					exit_code: recordIdx % 4 === 0 ? 2 : 0,
					text: "result",
				}),
			);
			if (index === 1 && recordIdx > 40) break;
		}
		values.push(
			row(
				generation.sessionId,
				generation.revision,
				TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
				{
					kind: "receipt",
					agent_id: "",
					tool_name: "",
					call_id: "",
				},
			),
		);
	}
	await clickhouse.insert({
		table: "rudel.transcript_records",
		values,
		asyncInsert: false,
	});
});

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.transcript_record_commands",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String}`,
			query_params: { organizationId },
		});
});

const base = { source: "calls" } as unknown as AnalysisFindInput;

function rowsOf(
	stored: boolean,
	input: Partial<AnalysisFindInput>,
	random = false,
) {
	return clickhouse.query(
		buildCallRowsStatement(
			{ scope, generations, input: { ...base, ...input }, stored },
			random ? { order: "random", seed: "seed" } : { order: "time" },
			10_000,
		),
	);
}

const sorted = (rows: unknown[]) =>
	rows.map((value) => JSON.stringify(value)).sort();

async function groupsOf(stored: boolean, groupBy: CallGroupBy) {
	const rows = await clickhouse.query<{ examples: unknown[]; runs: unknown[] }>(
		buildCallGroupsStatement(
			{ scope, generations, input: base, stored },
			groupBy,
		),
	);
	return sorted(
		rows.map((group) => ({
			...group,
			runs: sorted(group.runs),
		})),
	);
}

test("the stored command identity answers every calls query exactly as the per-query expressions did", async () => {
	const computedRows = await rowsOf(false, {});
	expect(computedRows.length).toBeGreaterThan(cases.length);
	expect(
		await missingCallCommandGenerations(clickhouse, scope, generations),
	).toHaveLength(2);
	expect(await ensureCallCommands(clickhouse, [{ scope, generations }])).toBe(
		2,
	);
	expect(await ensureCallCommands(clickhouse, [{ scope, generations }])).toBe(
		0,
	);
	expect(await rowsOf(true, {})).toEqual(computedRows);
	expect(await rowsOf(true, {}, true)).toEqual(await rowsOf(false, {}, true));
	for (const groupBy of [
		"commandFingerprint",
		"commandArgv0",
		"commandPrefix",
		"session",
	] as const)
		expect(await groupsOf(true, groupBy)).toEqual(
			await groupsOf(false, groupBy),
		);
	const sample = computedRows as {
		command_fingerprint: string | null;
		command_simhash: string | null;
		command_argv0: string | null;
		command_prefix: string | null;
		session_id: string;
		agent_id: string;
		record_idx: number;
		block_idx: number;
	}[];
	const withSimhash = sample.find((call) => call.command_simhash !== null);
	const withPrefix = sample.find((call) => call.command_prefix !== null);
	const filters: Partial<AnalysisFindInput>[] = [
		{ commandFrom: "written" },
		{ commandFrom: "script" },
		{ commandFingerprint: sample[0]?.command_fingerprint ?? "0" },
		{ commandSimhash: withSimhash?.command_simhash ?? "0" },
		{ commandArgv0: withPrefix?.command_argv0 ?? "" },
		{ commandPrefix: withPrefix?.command_prefix ?? "" },
	] as Partial<AnalysisFindInput>[];
	for (const filter of filters) {
		const computed = await rowsOf(false, filter);
		expect(computed.length).toBeGreaterThan(0);
		expect(await rowsOf(true, filter)).toEqual(computed);
	}
	const examples = sample
		.slice(0, 50)
		.map(
			(call) =>
				[
					call.session_id,
					call.agent_id,
					call.record_idx,
					call.block_idx,
				] as const,
		);
	expect(
		sorted(
			await clickhouse.query(
				buildCallExamplesStatement(scope, generations, examples, true),
			),
		),
	).toEqual(
		sorted(
			await clickhouse.query(
				buildCallExamplesStatement(scope, generations, examples, false),
			),
		),
	);
});
