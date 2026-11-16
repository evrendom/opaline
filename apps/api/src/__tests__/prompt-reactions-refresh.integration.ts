import "./helpers/local-integration-guard.js";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import { refreshPromptReactions } from "../services/analysis/prompt-reactions-refresh.js";
import { unhappyWordsPattern } from "../services/analysis/retro-measure-sql.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";

setDefaultTimeout(120_000);
const RUN = `prompt_reactions_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const memberId = `${RUN}_member`;
const sessionId = `${RUN}_session`;
const clickhouse = getClickhouse();
const SESSION_DATE = new Date(Date.now() - 3_600_000).toISOString();
const START = Date.now() - 3_000_000;
const SESSION = { organizationId: workspace, userId: memberId, sessionId };

const line = (second: number, body: Record<string, unknown>) =>
	JSON.stringify({
		sessionId: "reactions",
		cwd: "/repo",
		version: "2.1.292",
		entrypoint: "cli",
		timestamp: new Date(START + second * 1000).toISOString(),
		...body,
	});
const prompt = (second: number, text: string) =>
	line(second, { type: "user", message: { role: "user", content: text } });
const said = (second: number, text: string) =>
	line(second, {
		type: "assistant",
		message: { role: "assistant", content: [{ type: "text", text }] },
	});

const TRANSCRIPT = [
	prompt(1, "add a settings page"),
	said(5, "Done. I added the settings page."),
	prompt(60, "the settings page is horrible"),
	said(65, "Done. I restyled it."),
	prompt(120, "that is so fucking fast"),
	said(125, "Glad it helps."),
	prompt(180, "it still doesnt load"),
	said(185, "Done. It loads now."),
];

async function upload() {
	const content = TRANSCRIPT.join("\n");
	const identity = {
		organizationId: workspace,
		userId: memberId,
		sessionId,
		source: "claude_code" as const,
		revision: "1",
		sessionDate: SESSION_DATE,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{ content, sessionDate: SESSION_DATE, source: "claude_code" },
			stats,
		),
	].map((draft) => buildTranscriptRecordRow(identity, draft));
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(content),
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId: memberId, source: "claude_code", sessionId },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

async function storeAsOlderRules(reactions: Record<number, string[]>) {
	const turns = Object.keys(reactions).map(Number);
	await clickhouse.execute({
		clickhouse_settings: { insert_deduplicate: 0 },
		query: `INSERT INTO rudel.run_index
			SELECT * REPLACE (
				CAST({reactions:Array(Array(String))}[indexOf({turns:Array(UInt32)}, turn_idx)]
					AS Array(LowCardinality(String))) AS prompt_reactions
			)
			FROM (
				SELECT * FROM rudel.run_index FINAL
				WHERE organization_id = {workspace:String} AND session_id = {sessionId:String}
					AND row_kind = 'run' AND agent_id = '' AND has({turns:Array(UInt32)}, turn_idx)
			)`,
		query_params: {
			workspace,
			sessionId,
			turns,
			reactions: turns.map((turn) => reactions[turn] ?? []),
		},
	});
}

async function storedReactions() {
	const rows = await clickhouse.query<{
		turn_idx: number;
		prompt_reactions: string[];
	}>({
		query: `SELECT turn_idx, prompt_reactions FROM rudel.run_index FINAL
			WHERE organization_id = {workspace:String} AND session_id = {sessionId:String}
				AND row_kind = 'run' AND agent_id = ''
			ORDER BY turn_idx`,
		query_params: { workspace, sessionId },
	});
	return rows.map((row) => [Number(row.turn_idx), row.prompt_reactions]);
}

beforeAll(async () => {
	await upload();
});

afterAll(async () => {
	for (const name of ["transcript_records", "run_index"])
		await clickhouse.execute({
			query: `DELETE FROM rudel.${name} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

describe("prompt reactions refresh", () => {
	test("the build stores the current rules' reactions", async () => {
		expect(await storedReactions()).toEqual([
			[1, []],
			[2, ["negative"]],
			[3, ["positive"]],
			[4, ["negative"]],
		]);
	});

	test("rewrites the runs older rules read differently, in place, and leaves the rest", async () => {
		await storeAsOlderRules({ 2: [], 3: ["swear"] });
		expect(await storedReactions()).toEqual([
			[1, []],
			[2, []],
			[3, ["swear"]],
			[4, ["negative"]],
		]);
		const fenced: string[] = [];

		expect(
			await refreshPromptReactions(clickhouse, SESSION, async () => {
				fenced.push("checked");
			}),
		).toBe(2);
		expect(fenced).toEqual(["checked"]);
		expect(await storedReactions()).toEqual([
			[1, []],
			[2, ["negative"]],
			[3, ["positive"]],
			[4, ["negative"]],
		]);
		expect(await refreshPromptReactions(clickhouse, SESSION)).toBe(0);
	});

	test("a reaction set back to an earlier value is written again", async () => {
		await storeAsOlderRules({ 2: [] });
		expect(await refreshPromptReactions(clickhouse, SESSION)).toBe(1);
		await storeAsOlderRules({ 2: [] });
		expect(await refreshPromptReactions(clickhouse, SESSION)).toBe(1);
		expect((await storedReactions())[1]).toEqual([2, ["negative"]]);
	});

	test("a session without a committed build is left alone", async () => {
		expect(
			await refreshPromptReactions(clickhouse, {
				...SESSION,
				sessionId: `${RUN}_missing`,
			}),
		).toBe(0);
	});
});

describe("unhappy words in ClickHouse", () => {
	test("RE2 runs the word pattern with its patterns", async () => {
		const [row] = await clickhouse.query<{ words: string[] }>({
			query:
				"SELECT arrayMap(x -> lowerUTF8(x), extractAll({text:String}, {pattern:String})) AS words",
			query_params: {
				text: "this is ugly, and the fuckign page is not loading",
				pattern: unhappyWordsPattern(),
			},
		});
		expect(row?.words).toEqual(["ugly", "fuckign", "is not loading"]);
	});
});
