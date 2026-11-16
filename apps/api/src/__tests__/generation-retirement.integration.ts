import "./helpers/local-integration-guard.js";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import {
	encodeTranscriptRecordsReceipt,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import {
	type GenerationStore,
	RETIREMENT_GRACE_MS,
	retireGenerations,
} from "../services/generation-retirement/retirement.js";
import {
	chunkHitsStore,
	gitObservationsStore,
	runIndexStore,
	transcriptRecordsStore,
} from "../services/generation-retirement/stores.js";
import { drainTranscriptRecordsRetirement } from "../services/transcript-records-retirement-drain.service.js";

const clickhouse = getClickhouse();
const organizationId = `retirement-${crypto.randomUUID()}`;
const drainOrganizationId = `retirement-drain-${crypto.randomUUID()}`;
const userId = "member";
const NOW = Date.now();
const RECEIPT = TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX;
const at = (minutesAgo: number) =>
	new Date(NOW - minutesAgo * 60_000)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
const TABLES = [
	"rudel.transcript_records",
	"rudel.transcript_record_commands",
	"rudel.run_index",
	"rudel.session_git_observations",
	"rudel.transcript_chunk_hits",
];

function receiptHead(revision: string, publishedMinutesAgo: number) {
	return encodeTranscriptRecordsReceipt({
		contentSha256: "x",
		lineCount: 1,
		oversizedLineCount: 0,
		parserVersion: 8,
		publishedAt: new Date(NOW - publishedMinutesAgo * 60_000).toISOString(),
		rowCount: Number(revision),
		streamCount: 1,
		textTruncated: false,
		unparseableLineCount: 0,
	});
}

function transcriptGeneration(
	sessionId: string,
	revision: string,
	publishedMinutesAgo: number | null,
	owner = organizationId,
) {
	const base = {
		organization_id: owner,
		user_id: userId,
		session_id: sessionId,
		source: "claude_code",
		agent_id: "",
		revision,
		parser_version: 8,
		block_idx: 0,
		ts: at(publishedMinutesAgo ?? 0),
		session_date: at(0),
	};
	return [
		{ ...base, record_idx: 1, turn_idx: 1, kind: "user_prompt", head: "" },
		...(publishedMinutesAgo === null
			? []
			: [
					{
						...base,
						record_idx: RECEIPT,
						turn_idx: 0,
						kind: "receipt",
						head: receiptHead(revision, publishedMinutesAgo),
					},
				]),
	];
}

function commandRows(
	sessionId: string,
	revision: string,
	owner = organizationId,
) {
	const base = {
		organization_id: owner,
		user_id: userId,
		session_id: sessionId,
		revision,
		parser_version: 8,
		agent_id: "",
		block_idx: 0,
		source: "claude_code",
		session_date: at(0),
		ts: at(0),
		built_at: at(0),
	};
	return [
		{ ...base, record_idx: 1, command_from: "call", command_text: "ls" },
		{ ...base, record_idx: RECEIPT },
	];
}

function snapshot(
	sessionId: string,
	build: string,
	minutesAgo: number,
	committed: boolean,
) {
	const base = {
		organization_id: organizationId,
		user_id: userId,
		session_id: sessionId,
		revision: "2",
		parser_version: 8,
		index_version: 1,
		build_revision: build,
		agent_id: "",
		built_at: at(minutesAgo),
	};
	return [
		{ ...base, start_record: 1, row_kind: "run" },
		...(committed
			? [{ ...base, start_record: RECEIPT, row_kind: "receipt" }]
			: []),
	];
}

function observed(
	table: "rudel.session_git_observations" | "rudel.transcript_chunk_hits",
	sessionId: string,
	revision: string,
	committed: boolean,
) {
	const base = {
		organization_id: organizationId,
		user_id: userId,
		source: "claude_code",
		session_id: sessionId,
		revision,
		parser_version: 1,
		agent_id: "",
		block_idx: 0,
		ts: at(0),
		...(table === "rudel.transcript_chunk_hits" ? { written_at: at(0) } : {}),
	};
	return [
		{ ...base, record_idx: 1, kind: "commit_created" },
		...(committed ? [{ ...base, record_idx: RECEIPT, kind: "receipt" }] : []),
	];
}

async function stored(
	table: string,
	sessionId: string,
	owner = organizationId,
) {
	const rows = await clickhouse.query<{ generation: string }>({
		query: `SELECT DISTINCT concat(toString(revision), '/', toString(parser_version)${
			table === "rudel.run_index" ? ", '/', toString(build_revision)" : ""
		}) AS generation
			FROM ${table}
			WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String}
			ORDER BY generation`,
		query_params: { organizationId: owner, sessionId },
	});
	return rows.map((row) => row.generation);
}

const census = (store: GenerationStore) =>
	store
		.findSessions(clickhouse, {
			window: {},
			limit: 100,
			retireBefore: NOW - RETIREMENT_GRACE_MS,
			organizationId,
		})
		.then((sessions) => sessions.map((session) => session.key.join("/")));

const selfHosted = process.env.OPALINE_SELF_HOSTED;

beforeAll(async () => {
	const insert = (table: string, values: object[]) =>
		clickhouse.insert({ table, values, asyncInsert: false });
	await insert("rudel.transcript_records", [
		...transcriptGeneration("records", "50", null),
		...transcriptGeneration("records", "100", 60),
		...transcriptGeneration("records", "200", 30),
		...transcriptGeneration("records", "300", 1),
		...transcriptGeneration("recent", "100", 5),
		...transcriptGeneration("recent", "200", 1),
		...transcriptGeneration("single", "100", 60),
		...transcriptGeneration("drained", "100", 60, drainOrganizationId),
		...transcriptGeneration("drained", "200", 30, drainOrganizationId),
	]);
	await insert("rudel.transcript_record_commands", [
		...commandRows("records", "100"),
		...commandRows("records", "300"),
		...commandRows("drained", "100", drainOrganizationId),
		...commandRows("drained", "200", drainOrganizationId),
	]);
	await insert("rudel.run_index", [
		...snapshot("index", "40", 40, false),
		...snapshot("index", "50", 30, true),
		...snapshot("index", "51", 20, true),
		...snapshot("index-fresh", "50", 30, true),
		...snapshot("index-fresh", "51", 1, true),
	]);
	for (const table of [
		"rudel.session_git_observations",
		"rudel.transcript_chunk_hits",
	] as const)
		await insert(table, [
			...observed(table, "observed", "100", true),
			...observed(table, "observed", "200", true),
			...observed(table, "observed", "300", false),
			...observed(table, "observed-once", "100", true),
		]);
});

afterEach(() => {
	if (selfHosted === undefined) delete process.env.OPALINE_SELF_HOSTED;
	else process.env.OPALINE_SELF_HOSTED = selfHosted;
});

afterAll(async () => {
	for (const table of TABLES)
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id IN {organizationIds:Array(String)}`,
			query_params: { organizationIds: [organizationId, drainOrganizationId] },
			clickhouse_settings: { lightweight_deletes_sync: "1" },
		});
});

describe("transcript records", () => {
	test("the census finds the sessions a generation of which was superseded past the grace", async () => {
		expect(await census(transcriptRecordsStore)).toEqual(["member/records"]);
	});

	test("a pass retires what the committed generation superseded past the grace, and its stored commands first", async () => {
		process.env.OPALINE_SELF_HOSTED = "1";
		const [read] = await transcriptRecordsStore.readGenerations(
			clickhouse,
			organizationId,
			[{ organizationId, key: [userId, "records"] }],
		);
		expect(
			read?.generations.map((generation) => [
				generation.key.join("/"),
				generation.committed,
				generation.rows,
			]),
		).toEqual([
			["300/8", true, 300],
			["200/8", true, 200],
			["100/8", true, 100],
			["50/8", false, null],
		]);

		const result = await retireGenerations(clickhouse, transcriptRecordsStore, {
			organizationId,
		});
		expect(result).toMatchObject({ retired: 2, hasMore: false });
		expect(await stored("rudel.transcript_records", "records")).toEqual([
			"200/8",
			"300/8",
		]);
		expect(await stored("rudel.transcript_record_commands", "records")).toEqual(
			["300/8"],
		);
		expect(await stored("rudel.transcript_records", "recent")).toEqual([
			"100/8",
			"200/8",
		]);
	});

	test("the operator drain deletes the retired generations' stored commands too", async () => {
		process.env.OPALINE_SELF_HOSTED = "1";
		const result = await drainTranscriptRecordsRetirement(clickhouse, {
			execute: true,
			maxSessions: 10,
			organizationId: drainOrganizationId,
			pageSize: 10,
			pauseMs: 0,
		});
		expect(result).toMatchObject({ generations: 1, hasMore: false });
		expect(
			await stored("rudel.transcript_records", "drained", drainOrganizationId),
		).toEqual(["200/8"]);
		expect(
			await stored(
				"rudel.transcript_record_commands",
				"drained",
				drainOrganizationId,
			),
		).toEqual(["200/8"]);
	});
});

describe("run index", () => {
	test("the census finds sessions with a snapshot superseded or abandoned past the grace", async () => {
		expect(await census(runIndexStore)).toEqual(["member/index"]);
	});

	test("a pass retires the superseded and the abandoned snapshot, never the committed one", async () => {
		const result = await retireGenerations(clickhouse, runIndexStore, {
			organizationId,
		});
		expect(result).toMatchObject({ retired: 2, hasMore: false });
		expect(await stored("rudel.run_index", "index")).toEqual(["2/8/51"]);
		expect(await stored("rudel.run_index", "index-fresh")).toEqual([
			"2/8/50",
			"2/8/51",
		]);
	});
});

describe.each([
	["git observations", gitObservationsStore, "rudel.session_git_observations"],
	["chunk hits", chunkHitsStore, "rudel.transcript_chunk_hits"],
] as const)("%s", (_name, store, table) => {
	test("the census finds sessions with a generation below their newest receipt", async () => {
		expect(await census(store)).toEqual(["member/claude_code/observed"]);
	});

	test("a pass retires everything below the newest receipt at once and keeps a newer build", async () => {
		const result = await retireGenerations(clickhouse, store, {
			organizationId,
		});
		expect(result).toMatchObject({
			retired: 1,
			generations: 1,
			hasMore: false,
		});
		expect(await stored(table, "observed")).toEqual(["200/1", "300/1"]);
		expect(await stored(table, "observed-once")).toEqual(["100/1"]);
	});
});
