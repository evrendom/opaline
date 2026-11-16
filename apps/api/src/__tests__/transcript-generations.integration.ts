import "./helpers/local-integration-guard.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import {
	newestGenerations,
	pinnedParams,
	pinnedRecords,
	pinnedRows,
	readCommittedGenerations,
	type SessionGeneration,
} from "../services/transcript-generations/generations.js";

const clickhouse = getClickhouse();
const organizationId = `generations-${crypto.randomUUID()}`;
const scope = { organizationId, userId: "member" };
const ROWS_PER_GENERATION = 3_000;

function row(
	sessionId: string,
	revision: string,
	parserVersion: number,
	recordIdx: number,
	receipt: boolean,
) {
	return {
		organization_id: organizationId,
		user_id: scope.userId,
		session_id: sessionId,
		source: "claude_code",
		agent_id: "",
		revision,
		record_idx: recordIdx,
		block_idx: 0,
		turn_idx: receipt ? 0 : 1,
		ts: "2026-11-09 10:00:00.000",
		session_date: "2026-11-09 10:00:00.000",
		kind: receipt ? "receipt" : "assistant",
		parser_version: parserVersion,
		head: receipt ? `receipt ${revision}/${parserVersion}` : "",
	};
}

function generationRows(
	sessionId: string,
	revision: string,
	parserVersion: number,
	options: { readonly records: number; readonly committed: boolean },
) {
	return [
		...Array.from({ length: options.records }, (_, index) =>
			row(sessionId, revision, parserVersion, index, false),
		),
		...(options.committed
			? [
					row(
						sessionId,
						revision,
						parserVersion,
						TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
						true,
					),
				]
			: []),
	];
}

const committed: SessionGeneration[] = [
	{ sessionId: "many", revision: "20", parserVersion: 8 },
	{ sessionId: "one", revision: "5", parserVersion: 8 },
];

beforeAll(async () => {
	await clickhouse.insert({
		table: "rudel.transcript_records",
		values: [
			...generationRows("many", "10", 7, {
				records: ROWS_PER_GENERATION,
				committed: true,
			}),
			...generationRows("many", "20", 7, {
				records: ROWS_PER_GENERATION,
				committed: true,
			}),
			...generationRows("many", "20", 8, {
				records: ROWS_PER_GENERATION,
				committed: true,
			}),
			...generationRows("many", "30", 8, {
				records: ROWS_PER_GENERATION,
				committed: false,
			}),
			...generationRows("one", "5", 8, { records: 4, committed: true }),
			...generationRows("never", "9", 8, { records: 4, committed: false }),
		],
	});
});

afterAll(async () => {
	await clickhouse.execute({
		query:
			"DELETE FROM rudel.transcript_records WHERE organization_id = {organizationId:String}",
		query_params: { organizationId },
		clickhouse_settings: { lightweight_deletes_sync: "1" },
	});
});

async function count(where: string, generations: readonly SessionGeneration[]) {
	const [result] = await clickhouse.query<{ n: string }>({
		query: `SELECT count() AS n FROM rudel.transcript_records FINAL WHERE ${where}`,
		query_params: pinnedParams(scope, generations),
	});
	return Number(result?.n);
}

async function selectedGranules(
	where: string,
	params: Record<string, unknown>,
) {
	const plan = await clickhouse.query<{ explain: string }>({
		query: `EXPLAIN indexes = 1 SELECT count() FROM rudel.transcript_records WHERE ${where}`,
		query_params: params,
	});
	const text = plan.map((line) => line.explain).join("\n");
	const primaryKey = text.slice(text.indexOf("PrimaryKey"));
	const match = /Granules: (\d+)\/(\d+)/u.exec(primaryKey);
	if (match === null) throw new Error(`no granules in plan:\n${text}`);
	return { selected: Number(match[1]), total: Number(match[2]) };
}

describe("transcript generations", () => {
	test("the committed generation of a session is its newest receipt; a build without one is not committed", async () => {
		const generations = await readCommittedGenerations(clickhouse, scope, [
			"many",
			"one",
			"never",
		]);

		expect(
			generations.sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
		).toEqual([
			{
				sessionId: "many",
				revision: "20",
				parserVersion: 8,
				source: "claude_code",
				receipt: "receipt 20/8",
			},
			{
				sessionId: "one",
				revision: "5",
				parserVersion: 8,
				source: "claude_code",
				receipt: "receipt 5/8",
			},
		]);
		expect(await readCommittedGenerations(clickhouse, scope, [])).toEqual([]);
	});

	test("the newest generation of every session agrees with the committed one", async () => {
		const rows = await clickhouse.query<{
			session_id: string;
			revision: string;
			parser_version: number;
		}>({
			query: `SELECT session_id, toString(generation.1) AS revision, generation.2 AS parser_version
				FROM (${newestGenerations({ and: "AND organization_id = {organizationId:String}" })})
				ORDER BY session_id`,
			query_params: { organizationId },
		});

		expect(rows).toEqual([
			{ session_id: "many", revision: "20", parser_version: 8 },
			{ session_id: "one", revision: "5", parser_version: 8 },
		]);
	});

	test("pinned rows are the pinned generations' rows with their receipts, pinned records without", async () => {
		expect(await count(pinnedRows(), committed)).toBe(
			ROWS_PER_GENERATION + 1 + 4 + 1,
		);
		expect(await count(pinnedRecords(), committed)).toBe(
			ROWS_PER_GENERATION + 4,
		);
		expect(
			await count(pinnedRecords(), [
				{ sessionId: "many", revision: "10", parserVersion: 7 },
			]),
		).toBe(ROWS_PER_GENERATION);
		expect(await count(pinnedRecords(), [])).toBe(0);
	});

	test("the pinned filter reads only the pinned generation's granules", async () => {
		const pinned = await selectedGranules(
			pinnedRows(),
			pinnedParams(scope, [committed[0] as SessionGeneration]),
		);
		const session = await selectedGranules(
			"organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id = 'many'",
			scope,
		);

		expect(session.selected).toBeGreaterThanOrEqual(
			(4 * ROWS_PER_GENERATION) / 1024,
		);
		expect(pinned.selected).toBeLessThan(session.selected / 2);
	});
});
