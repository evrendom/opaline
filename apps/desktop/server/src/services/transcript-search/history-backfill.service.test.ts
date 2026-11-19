import { expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { ClickHouseWriteFencedError } from "../../lib/clickhouse-write-fence.js";
import { receiptRow } from "../transcript-generations/generations.js";
import type { TranscriptEmbedder } from "./config.js";
import {
	backfillTranscriptSearch,
	buildTranscriptSearchBackfillStatement,
	decodeTranscriptSearchBackfillCursor,
	previewTranscriptSearchBackfill,
	type TranscriptSearchBackfillEnv,
	type TranscriptSearchBackfillOptions,
} from "./history-backfill.service.js";
import { createMemoryEmbeddingQuota, type EmbeddingQuota } from "./quota.js";
import { TRANSCRIPT_CHUNK_HITS_TABLE } from "./tables.js";

/**
 * The history backfill over a stand-in ClickHouse: it answers the selection
 * with the sessions given (in the newest-first order the statement asks
 * for), the estimate with their characters, the load average from a list,
 * and the indexing pass's reads from the session's records and what earlier
 * passes inserted. OpenAI is a fake that keeps what it is sent; time is a
 * fake clock whose sleeps are recorded.
 */

interface FakeSession {
	readonly organizationId: string;
	readonly sessionId: string;
	readonly sessionDate: string;
	readonly texts: readonly string[];
	readonly reason?: "missing" | "generation" | "pending";
	/** Characters the estimate reports. */
	readonly chars?: number;
	/** Fails the session's records read. */
	readonly broken?: boolean;
}

const USER = "member-1";

function world(sessions: readonly FakeSession[], loads: number[] = []) {
	const statements: ClickHouseStatement[] = [];
	const inserts: { table: string; values: Record<string, unknown>[] }[] = [];
	const inserted = (table: string) =>
		inserts
			.filter((insert) => insert.table === table)
			.flatMap((insert) => insert.values);
	const sessionOf = (statement: ClickHouseStatement) => {
		const found = sessions.find(
			(session) => session.sessionId === statement.query_params?.sessionId,
		);
		if (!found) throw new Error("unknown session");
		return found;
	};
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async ({ table, values }) => {
			inserts.push({ table, values: values as Record<string, unknown>[] });
		},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			const sql = statement.query;
			if (sql.includes("system.asynchronous_metrics"))
				return [{ value: loads.shift() ?? 1 }] as T[];
			if (sql.includes("AS reason"))
				return sessions
					.slice(0, Number(statement.query_params?.limit))
					.map((session) => ({
						organization_id: session.organizationId,
						user_id: USER,
						session_id: session.sessionId,
						source: "claude_code",
						session_date: session.sessionDate,
						reason: session.reason ?? "missing",
					})) as T[];
			if (sql.includes("AS chars"))
				return sessions.map((session) => ({
					organization_id: session.organizationId,
					user_id: USER,
					session_id: session.sessionId,
					chars: session.chars ?? 0,
				})) as T[];
			if (sql.includes("FROM rudel.transcript_chunks")) {
				const hashes = new Set(statement.query_params?.hashes as string[]);
				return inserted("rudel.transcript_chunks")
					.filter((row) => hashes.has(String(row.chunk_hash)))
					.map((row) => ({
						chunk_hash: row.chunk_hash,
						months: [row.month],
						embedded_months:
							(row.embedding as number[]).length > 0 ? [row.month] : [],
						vector: row.embedding,
						vector_model: row.model,
					})) as T[];
			}
			if (sql.includes(`FROM ${TRANSCRIPT_CHUNK_HITS_TABLE} FINAL`))
				return inserted(TRANSCRIPT_CHUNK_HITS_TABLE)
					.filter(
						(row) =>
							row.kind === "receipt" &&
							row.session_id === statement.query_params?.sessionId,
					)
					.slice(-1)
					.map((row) => ({
						revision_text: String(row.revision),
						parser_version: row.parser_version,
						pending_chunks: row.pending_chunks,
					})) as T[];
			if (sql.includes(receiptRow()))
				return [{ revision_text: "7", parser_version: 3 }] as T[];
			if (sql.includes("FROM rudel.transcript_records")) {
				const session = sessionOf(statement);
				if (session.broken) throw new Error("records unreadable");
				return session.texts.map((text, index) => ({
					agent_id: "",
					record_idx: index + 1,
					block_idx: 0,
					turn_idx: 1,
					kind: "user_prompt",
					tool_name: "",
					ts: "2026-05-04 10:00:00.000",
					text,
					head: text,
					tail: "",
					text_chars: text.length,
				})) as T[];
			}
			return [] as T[];
		},
	};
	return { executor, statements, inserted };
}

function fakeEmbedder(tokensPerCall: number): TranscriptEmbedder & {
	texts: string[];
} {
	const texts: string[] = [];
	return {
		texts,
		model: "fake@3",
		async embed(input) {
			texts.push(...input);
			return { vectors: input.map(() => [0.6, 0.8, 0]), tokens: tokensPerCall };
		},
	};
}

function fakeClock() {
	let at = 0;
	const sleeps: number[] = [];
	return {
		sleeps,
		now: () => at,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			at += ms;
		},
	};
}

function environment(
	executor: ClickHouseExecutor,
	overrides: Partial<TranscriptSearchBackfillEnv> = {},
): TranscriptSearchBackfillEnv {
	return {
		executor,
		access: { indexes: async () => true, notIndexed: "not indexed" },
		quota: createMemoryEmbeddingQuota({ tokens: 1e9, windowMs: 86_400_000 }),
		listWorkspaces: async () => ["ws-1"],
		assertWritable: async () => {},
		clock: fakeClock(),
		...overrides,
	};
}

const OPTIONS: TranscriptSearchBackfillOptions = {
	organizationId: "ws-1",
	maxSessions: 100,
	after: undefined,
	sessionsPerMinute: 30,
	maxLoad: 12,
};

function session(sessionId: string, texts: readonly string[]): FakeSession {
	return {
		organizationId: "ws-1",
		sessionId,
		sessionDate: `2026-05-0${sessionId.slice(-1)} 10:00:00.000`,
		texts,
	};
}

test("a preview estimates the selected sessions' tokens and cost per workspace, writes nothing, and names where a full page continues", async () => {
	const { executor, statements, inserted } = world([
		{ ...session("s-3", ["a"]), chars: 1_000_000 },
		{ ...session("s-2", ["b"]), chars: 3_000_000, reason: "pending" },
	]);
	const quota = createMemoryEmbeddingQuota({ tokens: 1e6, windowMs: 1e9 });
	await quota.charge("ws-1", 400_000);

	const preview = await previewTranscriptSearchBackfill(
		environment(executor, { quota }),
		{ ...OPTIONS, maxSessions: 2 },
	);

	expect(preview).toMatchObject({
		status: "preview",
		candidates: 2,
		byReason: { missing: 1, generation: 0, pending: 1 },
		// 4M characters, chunks overlapping 200 of 1,200, at 4 per token.
		estimatedTokens: 1_200_000,
		estimatedCostUsd: 0.024,
		workspaces: [
			{
				organizationId: "ws-1",
				sessions: 2,
				estimatedTokens: 1_200_000,
				quotaUsed: 400_000,
				quotaLimit: 1_000_000,
				fitsQuota: false,
			},
		],
		hasMore: true,
	});
	expect(decodeTranscriptSearchBackfillCursor(String(preview.next))).toEqual({
		sessionDate: "2026-05-02 10:00:00.000",
		organizationId: "ws-1",
		userId: USER,
		sessionId: "s-2",
	});
	expect(inserted(TRANSCRIPT_CHUNK_HITS_TABLE)).toEqual([]);
	expect(
		statements.some((statement) =>
			statement.query.includes("asynchronous_metrics"),
		),
	).toBe(false);
});

test("only workspaces search indexes are selected; a workspace search does not index gets nothing and is told why", async () => {
	const { executor, statements } = world([session("s-1", ["a"])]);
	const env = environment(executor, {
		listWorkspaces: async () => ["paid", "free", "listed"],
		access: {
			indexes: async (workspaceId) => workspaceId !== "free",
			notIndexed: "search is not enabled for this workspace yet",
		},
	});

	const all = await previewTranscriptSearchBackfill(env, {
		...OPTIONS,
		organizationId: undefined,
	});
	const free = await previewTranscriptSearchBackfill(env, {
		...OPTIONS,
		organizationId: "free",
	});

	expect(all.workspacesNotIndexed).toBe(1);
	expect(statements[0]?.query_params?.organizationIds).toEqual([
		"paid",
		"listed",
	]);
	expect(free).toMatchObject({ candidates: 0, workspacesNotIndexed: 1 });
	expect(free.message).toBe(
		"search is not enabled for this workspace yet, and TRANSCRIPT_EMBEDDINGS_WORKSPACES does not list it.",
	);
	expect(
		statements.filter((statement) => statement.query.includes("AS reason")),
	).toHaveLength(1);
});

test("when every workspace is indexed (`*`) the selection sends no list, and a cursor from another workspace is refused", async () => {
	const { executor, statements } = world([session("s-1", ["a"])]);
	const env = environment(executor, {
		listWorkspaces: async () => ["ws-1", "ws-2"],
	});

	const all = await previewTranscriptSearchBackfill(env, {
		...OPTIONS,
		organizationId: undefined,
	});

	expect(all).toMatchObject({ organizationId: null, workspacesNotIndexed: 0 });
	expect(statements[0]?.query).not.toContain("organizationIds");
	await expect(
		previewTranscriptSearchBackfill(env, {
			...OPTIONS,
			after: {
				sessionDate: "2026-05-01 10:00:00.000",
				organizationId: "ws-2",
				userId: USER,
				sessionId: "s-1",
			},
		}),
	).rejects.toThrow("--after");
});

test("execute indexes each selected session through the upload's indexing pass and leaves one already indexed at its generation", async () => {
	const { executor, inserted } = world([
		session("s-2", ["deploy the billing worker"]),
		session("s-1", ["rotate the signing keys"]),
	]);
	const embedder = fakeEmbedder(5);
	const env = { ...environment(executor), embedder };
	// An upload indexed s-1 after the selection read it.
	await executor.insert({
		table: TRANSCRIPT_CHUNK_HITS_TABLE,
		values: [
			{
				kind: "receipt",
				session_id: "s-1",
				revision: "7",
				parser_version: 3,
				pending_chunks: 0,
			},
		],
	});

	const result = await backfillTranscriptSearch(env, OPTIONS);

	expect(result).toMatchObject({
		status: "executed",
		indexed: 1,
		alreadyCurrent: 1,
		embeddedChunks: 1,
		tokensCharged: 5,
		stopped: null,
		hasMore: false,
		next: null,
	});
	expect(embedder.texts).toEqual(["deploy the billing worker"]);
	expect(
		inserted(TRANSCRIPT_CHUNK_HITS_TABLE).filter(
			(row) => row.session_id === "s-2" && row.kind === "receipt",
		),
	).toHaveLength(1);
});

test("execute starts at most the given sessions a minute and waits while ClickHouse's load is above the threshold", async () => {
	const { executor } = world(
		[session("s-3", ["one"]), session("s-2", ["two"]), session("s-1", ["six"])],
		[20, 13, 2, 2, 12],
	);
	const clock = fakeClock();

	const result = await backfillTranscriptSearch(
		{ ...environment(executor, { clock }), embedder: fakeEmbedder(1) },
		{ ...OPTIONS, sessionsPerMinute: 30 },
	);

	expect(clock.sleeps).toEqual([30_000, 30_000, 2_000, 2_000]);
	expect(result).toMatchObject({ indexed: 3, loadPausedSeconds: 60 });
});

test("a session the pass's limits stopped short gets further passes, each paced, until every chunk has a vector", async () => {
	const { executor } = world([
		session("s-1", ["first prompt", "second prompt", "third prompt"]),
	]);
	const clock = fakeClock();

	const result = await backfillTranscriptSearch(
		{
			...environment(executor, {
				clock,
				limits: { embedChunks: 1, batchSize: 1 },
			}),
			embedder: fakeEmbedder(1),
		},
		OPTIONS,
	);

	expect(result).toMatchObject({
		indexed: 1,
		incomplete: 0,
		passes: 3,
		embeddedChunks: 3,
	});
	expect(clock.sleeps).toEqual([2_000, 2_000]);
});

test("the run stops when a workspace uses its quota mid-session, saying so, and continues from before that session", async () => {
	const { executor } = world([
		session("s-3", ["first"]),
		session("s-2", ["second", "third"]),
		session("s-1", ["fourth"]),
	]);
	const embedder = fakeEmbedder(150);

	const result = await backfillTranscriptSearch(
		{
			...environment(executor, {
				quota: createMemoryEmbeddingQuota({ tokens: 250, windowMs: 1e9 }),
				limits: { batchSize: 1 },
			}),
			embedder,
		},
		OPTIONS,
	);

	expect(embedder.texts).toEqual(["first", "second"]);
	expect(result).toMatchObject({
		indexed: 1,
		stopped: "quota",
		hasMore: true,
		tokensCharged: 300,
	});
	expect(result.message).toContain("ws-1 has used its OpenAI quota");
	expect(result.message).toContain(`--after ${result.next}`);
	expect(
		decodeTranscriptSearchBackfillCursor(String(result.next)).sessionId,
	).toBe("s-3");
});

test("a workspace already out of quota is not indexed at all", async () => {
	const { executor, statements } = world([session("s-1", ["first"])]);
	const quota: EmbeddingQuota = createMemoryEmbeddingQuota({
		tokens: 10,
		windowMs: 1e9,
	});
	await quota.charge("ws-1", 10);

	const result = await backfillTranscriptSearch(
		{ ...environment(executor, { quota }), embedder: fakeEmbedder(1) },
		OPTIONS,
	);

	expect(result).toMatchObject({
		stopped: "quota",
		passes: 0,
		hasMore: true,
		next: null,
	});
	expect(result.message).toContain("without --after");
	expect(result.message).toContain("ws-1 has used its OpenAI quota");
	expect(
		statements.some(
			(statement) =>
				statement.query.includes("rudel.transcript_records FINAL") ||
				statement.query.includes("AS reason"),
		),
	).toBe(false);
});

test("a run selects only the workspaces with quota left, while a preview still selects every indexed workspace", async () => {
	const { executor, statements } = world([session("s-1", ["first"])]);
	const quota = createMemoryEmbeddingQuota({ tokens: 10, windowMs: 1e9 });
	await quota.charge("spent", 10);
	const env = environment(executor, {
		quota,
		listWorkspaces: async () => ["spent", "ws-1"],
	});
	const everyWorkspace = { ...OPTIONS, organizationId: undefined };

	await backfillTranscriptSearch(
		{ ...env, embedder: fakeEmbedder(1) },
		everyWorkspace,
	);
	await previewTranscriptSearchBackfill(env, everyWorkspace);

	const selections = statements.filter((statement) =>
		statement.query.includes("AS reason"),
	);
	expect(selections.map((s) => s.query_params?.organizationIds)).toEqual([
		["ws-1"],
		[],
	]);
	expect(selections[1]?.query).not.toContain("organizationIds");
});

test("a failing session is reported and the run goes on; a session being deleted is left alone", async () => {
	const { executor } = world([
		session("s-3", ["first"]),
		{ ...session("s-2", ["second"]), broken: true },
		session("s-1", ["third"]),
	]);
	// s-3 writes its chunks, hits and receipt; s-1's first write meets a purge.
	let writes = 0;

	const result = await backfillTranscriptSearch(
		{
			...environment(executor, {
				assertWritable: async () => {
					writes++;
					if (writes > 3) throw new ClickHouseWriteFencedError();
				},
			}),
			embedder: fakeEmbedder(1),
		},
		OPTIONS,
	);

	expect(result).toMatchObject({ indexed: 1, failed: 1, fenced: 1 });
	expect(result.issues).toEqual([
		{
			organizationId: "ws-1",
			userId: USER,
			sessionId: "s-2",
			error: "records unreadable",
		},
	]);
});

test("an interrupted run stops before its next session and names where to continue", async () => {
	const { executor } = world([
		session("s-3", ["first"]),
		session("s-2", ["second"]),
	]);
	const controller = new AbortController();
	const clock = fakeClock();

	const result = await backfillTranscriptSearch(
		{
			...environment(executor, {
				clock: {
					now: clock.now,
					sleep: async (ms) => {
						controller.abort();
						await clock.sleep(ms);
					},
				},
			}),
			embedder: fakeEmbedder(1),
		},
		{ ...OPTIONS, signal: controller.signal },
	);

	expect(result).toMatchObject({
		indexed: 1,
		stopped: "interrupted",
		hasMore: true,
	});
	expect(
		decodeTranscriptSearchBackfillCursor(String(result.next)).sessionId,
	).toBe("s-3");
});

test("--after takes only a value a run printed", () => {
	expect(() => decodeTranscriptSearchBackfillCursor("nonsense")).toThrow(
		"--after",
	);
});

test("a shard selects only the sessions whose id hashes to it, so lanes never overlap", () => {
	const base = { organizationIds: ["ws"], after: undefined, limit: 10 };
	expect(buildTranscriptSearchBackfillStatement(base).query).not.toContain(
		"cityHash64",
	);
	const statement = buildTranscriptSearchBackfillStatement({
		...base,
		shard: { index: 3, count: 8 },
	});
	expect(statement.query).toContain(
		"AND cityHash64(records.session_id) % {shardCount:UInt32} = {shardIndex:UInt32}",
	);
	expect(statement.query_params).toMatchObject({
		shardCount: 8,
		shardIndex: 3,
	});
});
