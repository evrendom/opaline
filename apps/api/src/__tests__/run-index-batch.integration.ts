import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import { extractUsageEvents } from "@rudel/usage-events";
import { getClickhouse } from "../clickhouse.js";
import { readCommittedRunIndex } from "../services/analysis/run-index-reader.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	buildRunIndexBatch,
	runIndexBatches,
} from "../services/l1-edges/run-index-batch.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";
import { writeUsageExtraction } from "../services/usage-event-ingest.service.js";

setDefaultTimeout(240_000);

const RUN = `run_index_batch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const userId = `${RUN}_user`;
const single = `${RUN}_single`;
const batched = `${RUN}_batched`;
const clickhouse = getClickhouse();
const SESSION_DATE = new Date(Date.now() - 3_600_000).toISOString();

interface FixtureSession {
	readonly sessionId: string;
	readonly source: TranscriptSource;
	readonly content: string;
	readonly subagents?: Readonly<Record<string, string>>;
	readonly usage: boolean;
}

async function fixture(name: string): Promise<string> {
	return Bun.file(
		new URL(
			`../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/${name}`,
			import.meta.url,
		),
	).text();
}

async function sessions(): Promise<FixtureSession[]> {
	const claude = await fixture("claude-2.1.jsonl");
	const subagent = await fixture("claude-subagent-2.1.jsonl");
	return [
		{
			sessionId: `${RUN}_claude`,
			source: "claude_code",
			content: claude,
			usage: true,
		},
		{
			sessionId: `${RUN}_claude_subagent`,
			source: "claude_code",
			content: claude,
			subagents: { a1: subagent },
			usage: true,
		},
		{
			sessionId: `${RUN}_claude_v9`,
			source: "claude_code",
			content: await fixture("claude-v9.jsonl"),
			usage: true,
		},
		{
			sessionId: `${RUN}_claude_capture`,
			source: "claude_code",
			content: await fixture("claude-capture-2.1.jsonl"),
			usage: false,
		},
		{
			sessionId: `${RUN}_claude_record_ids`,
			source: "claude_code",
			content: await fixture("claude-record-ids.jsonl"),
			usage: true,
		},
		{
			sessionId: `${RUN}_codex`,
			source: "codex",
			content: await fixture("codex-0.156.jsonl"),
			usage: true,
		},
		{
			sessionId: `${RUN}_codex_v9`,
			source: "codex",
			content: await fixture("codex-v9.jsonl"),
			usage: true,
		},
		{
			sessionId: `${RUN}_codex_inner`,
			source: "codex",
			content: await fixture("codex-inner-calls-0.153.jsonl"),
			usage: false,
		},
		{
			sessionId: `${RUN}_codex_skill`,
			source: "codex",
			content: await fixture("codex-skill-0.162.jsonl"),
			usage: true,
		},
	];
}

async function publish(
	organizationId: string,
	session: FixtureSession,
): Promise<void> {
	const identity = {
		organizationId,
		userId,
		sessionId: session.sessionId,
		source: session.source,
		revision: "1",
		sessionDate: SESSION_DATE,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{
				content: session.content,
				sessionDate: SESSION_DATE,
				source: session.source,
				subagents: session.subagents,
			},
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
				contentSha256: hashTranscriptContent(
					session.content,
					session.subagents ?? {},
				),
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
		],
	});
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: organizationId,
				user_id: userId,
				session_id: session.sessionId,
				source: session.source,
				session_date: SESSION_DATE.replace("T", " ").replace("Z", ""),
				project_path: "/repo",
				git_remote: "git@github.com:acme/widgets.git",
				git_branch: "main",
				model_used: "claude-opus-4-1",
			},
		],
	});
	if (!session.usage) return;
	const extraction = extractUsageEvents({
		organizationId,
		userId,
		sessionId: session.sessionId,
		source: session.source,
		content: session.content,
		subagents: session.subagents ?? {},
	});
	if (extraction.status !== "complete") return;
	await writeUsageExtraction(clickhouse, {
		contentSha256: "a".repeat(64),
		extraction,
		filterVersion: 1,
		generation: "7",
		ingestedAt: new Date(),
		organizationId,
		sessionDate: new Date(SESSION_DATE),
		sessionId: session.sessionId,
		source: session.source,
		userId,
		refreshRollup: false,
	});
}

const TABLES = [
	"rudel.run_index",
	"rudel.run_requests",
	"rudel.run_setup",
	"rudel.call_facts",
] as const;

async function storedRows(
	table: (typeof TABLES)[number],
	organizationId: string,
): Promise<string[]> {
	const rows = await clickhouse.query<Record<string, unknown>>({
		query: `SELECT * EXCEPT (organization_id, build_revision, built_at)
			FROM ${table} FINAL WHERE organization_id = {organizationId:String}`,
		query_params: { organizationId },
		clickhouse_settings: { output_format_json_quote_64bit_integers: 1 },
	});
	return rows.map((row) => JSON.stringify(row)).sort();
}

afterAll(async () => {
	for (const organizationId of [single, batched])
		for (const table of [
			"rudel.transcript_records",
			"rudel.session_analytics",
			"rudel.usage_events",
			"rudel.usage_receipts",
			...TABLES,
		])
			await clickhouse
				.execute({
					query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
					query_params: { organizationId },
				})
				.catch(() => undefined);
});

test("batches split by sessions and records, a large session alone", () => {
	const plan = (records: number) => ({ plan: { records } });
	expect(
		runIndexBatches([plan(10), plan(20), plan(100), plan(5), plan(5)], {
			maxSessions: 3,
			maxRecords: 40,
		}).map((batch) => batch.map((entry) => entry.plan.records)),
	).toEqual([[10, 20], [100], [5, 5]]);
	expect(
		runIndexBatches([plan(1), plan(1), plan(1), plan(1)], {
			maxSessions: 3,
			maxRecords: 40,
		}).map((batch) => batch.length),
	).toEqual([3, 1]);
});

test("a batched build writes the rows each session's own build writes", async () => {
	const fixtures = await sessions();
	for (const organizationId of [single, batched])
		for (const session of fixtures) await publish(organizationId, session);

	for (const [index, session] of fixtures.entries()) {
		const build = await buildRunIndex({
			executor: clickhouse,
			organizationId: single,
			session: { userId, source: session.source, sessionId: session.sessionId },
			buildRevision: index + 1,
			beforeWrite: async () => {},
		});
		expect(build.written).toBe(true);
	}
	const writes: string[][] = [];
	const outcomes = await buildRunIndexBatch({
		executor: clickhouse,
		organizationId: batched,
		userId,
		claims: fixtures.map((session, index) => ({
			session: { userId, source: session.source, sessionId: session.sessionId },
			buildRevision: index + 1,
		})),
		beforeWrite: async (sessionIds) => {
			writes.push([...sessionIds]);
			return new Set(sessionIds);
		},
		limits: { maxSessions: 4, maxRecords: 1_000_000 },
	});
	expect(
		[...outcomes.values()].map((outcome) =>
			outcome.kind === "built" ? outcome.build.written : outcome.kind,
		),
	).toEqual(fixtures.map(() => true));
	expect(writes.length).toBe(15);

	for (const table of TABLES) {
		const expected = await storedRows(table, single);
		expect(expected.length).toBeGreaterThan(0);
		expect(await storedRows(table, batched)).toEqual(expected);
	}
	const committed = await readCommittedRunIndex(
		clickhouse,
		{ organizationId: batched, userId },
		fixtures.map((session) => session.sessionId),
		"receipt",
	);
	expect(committed.length).toBe(fixtures.length);

	const again = await buildRunIndexBatch({
		executor: clickhouse,
		organizationId: batched,
		userId,
		claims: fixtures.map((session, index) => ({
			session: { userId, source: session.source, sessionId: session.sessionId },
			buildRevision: 100 + index,
		})),
		beforeWrite: async () => {
			throw new Error("nothing should be written");
		},
	});
	expect(
		[...again.values()].every(
			(outcome) => outcome.kind === "built" && !outcome.build.written,
		),
	).toBe(true);
});

test("a session whose lease is lost writes nothing more; the others commit", async () => {
	const organizationId = `${RUN}_lease`;
	const fixtures = (await sessions()).slice(0, 3);
	for (const session of fixtures) await publish(organizationId, session);
	const lost = fixtures[1]?.sessionId ?? "";
	let calls = 0;
	const outcomes = await buildRunIndexBatch({
		executor: clickhouse,
		organizationId,
		userId,
		claims: fixtures.map((session, index) => ({
			session: { userId, source: session.source, sessionId: session.sessionId },
			buildRevision: index + 1,
		})),
		beforeWrite: async (sessionIds) => {
			calls++;
			return new Set(
				sessionIds.filter((sessionId) => calls === 1 || sessionId !== lost),
			);
		},
	});
	expect(outcomes.get(lost)?.kind).toBe("lease_lost");
	const receipts = await readCommittedRunIndex(
		clickhouse,
		{ organizationId, userId },
		fixtures.map((session) => session.sessionId),
		"receipt",
	);
	expect(receipts.map((row) => row.session_id).sort()).toEqual(
		fixtures
			.map((session) => session.sessionId)
			.filter((sessionId) => sessionId !== lost)
			.sort(),
	);
	for (const table of [
		...TABLES,
		"rudel.transcript_records",
		"rudel.session_analytics",
		"rudel.usage_events",
	])
		await clickhouse
			.execute({
				query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId },
			})
			.catch(() => undefined);
});
