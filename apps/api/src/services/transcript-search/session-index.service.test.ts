import { expect, test } from "bun:test";
import { buildTranscriptTextFields } from "@rudel/api-routes/transcript-records";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { receiptRow } from "../transcript-generations/generations.js";
import type { TranscriptEmbedder } from "./config.js";
import { createMemoryEmbeddingQuota } from "./quota.js";
import { indexSessionText } from "./session-index.service.js";
import {
	TRANSCRIPT_CHUNK_HITS_TABLE,
	TRANSCRIPT_CHUNKS_TABLE,
} from "./tables.js";

/**
 * Indexing a session for search as an upload runs it: ClickHouse is a
 * stand-in that serves the session's stored transcript records and keeps
 * every insert; OpenAI is a fake that keeps every text it is sent.
 */

/** A GitHub token as a JSON-escaped upload carries it and parsing decodes it. */
const TOKEN = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;

interface StoredRecord {
	agent_id?: string;
	record_idx: number;
	block_idx?: number;
	turn_idx?: number;
	kind?: string;
	tool_name?: string;
	ts?: string;
	text: string;
	head?: string;
	tail?: string;
	text_chars?: number;
}

function storage(
	initial: readonly StoredRecord[],
	options: { delayMs?: number } = {},
) {
	let records = initial;
	let recordPages = 0;
	const inserts: { table: string; values: Record<string, unknown>[] }[] = [];
	const inserted = (table: string) =>
		inserts
			.filter((insert) => insert.table === table)
			.flatMap((insert) => insert.values);
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async ({ table, values }) => {
			inserts.push({ table, values: values as Record<string, unknown>[] });
		},
		query: async <T>(statement: ClickHouseStatement) => {
			if (options.delayMs) await Bun.sleep(options.delayMs);
			const sql = statement.query;
			// The member's stored chunks of these hashes: the months they are
			// stored for, those with a vector, and one vector to copy.
			if (sql.includes("FROM rudel.transcript_chunks")) {
				const hashes = new Set(
					(statement.query_params?.hashes as string[] | undefined) ?? [],
				);
				const byHash = new Map<string, Record<string, unknown>[]>();
				for (const row of inserted(TRANSCRIPT_CHUNKS_TABLE))
					if (hashes.has(String(row.chunk_hash)))
						byHash.set(String(row.chunk_hash), [
							...(byHash.get(String(row.chunk_hash)) ?? []),
							row,
						]);
				return [...byHash].map(([hash, rows]) => {
					const embedded = rows.filter(
						(row) => (row.embedding as number[]).length > 0,
					);
					return {
						chunk_hash: hash,
						months: [...new Set(rows.map((row) => row.month))],
						embedded_months: [...new Set(embedded.map((row) => row.month))],
						vector: embedded[0]?.embedding ?? [],
						vector_model: embedded[0]?.model ?? "",
					};
				}) as T[];
			}
			if (
				sql.includes("FROM rudel.transcript_records") &&
				sql.includes(receiptRow())
			)
				return [{ revision_text: "7", parser_version: 3 }] as T[];
			if (sql.includes("FROM rudel.transcript_records")) {
				recordPages++;
				const params = statement.query_params ?? {};
				const key = (row: {
					agent_id: string;
					record_idx: number;
					block_idx: number;
				}) => [row.agent_id, row.record_idx, row.block_idx] as const;
				const after =
					params.afterAgentId === undefined
						? undefined
						: ([
								String(params.afterAgentId),
								Number(params.afterRecordIdx),
								Number(params.afterBlockIdx),
							] as const);
				return records
					.map((record) => ({
						agent_id: "",
						block_idx: 0,
						turn_idx: 1,
						kind: "tool_result",
						tool_name: "Bash",
						ts: "2026-10-12 10:00:00.000",
						head: record.text.slice(0, 1_024),
						tail: "",
						text_chars: [...record.text].length,
						...record,
					}))
					.sort((left, right) => compareKeys(key(left), key(right)))
					.filter((row) => !after || compareKeys(key(row), after) > 0)
					.slice(0, Number(params.pageRecords)) as T[];
			}
			return [] as T[];
		},
	};
	return {
		executor,
		inserted,
		recordPages: () => recordPages,
		upload: (next: readonly StoredRecord[]) => {
			records = next;
		},
	};
}

function compareKeys(
	left: readonly [string, number, number],
	right: readonly [string, number, number],
): number {
	if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
	return left[1] - right[1] || left[2] - right[2];
}

function fakeEmbedder(): TranscriptEmbedder & { texts: string[] } {
	const texts: string[] = [];
	return {
		texts,
		model: "fake@3",
		async embed(input) {
			texts.push(...input);
			return { vectors: input.map(() => [0.6, 0.8, 0]), tokens: 7 };
		},
	};
}

const session = {
	organizationId: "ws-1",
	userId: "member-1",
	source: "claude_code" as const,
	sessionId: "s-1",
	assertWritable: async () => {},
};

test("a credential the upload filter missed in escaped JSON is filtered from the decoded text before it is stored or embedded", async () => {
	const { executor, inserted } = storage([
		{ record_idx: 1, text: `export GITHUB_TOKEN=${TOKEN}\nthen push` },
	]);
	const embedder = fakeEmbedder();

	const outcome = await indexSessionText(session, {
		executor,
		embedder,
		quota: createMemoryEmbeddingQuota({ tokens: 1_000, windowMs: 86_400_000 }),
	});

	expect(outcome).toMatchObject({ status: "written", pending: 0 });
	const stored = inserted(TRANSCRIPT_CHUNKS_TABLE).map((row) =>
		String(row.text),
	);
	expect(stored).toEqual([
		"export GITHUB_TOKEN=[REDACTED:github-pat]\nthen push",
	]);
	expect(embedder.texts).toEqual(stored);
	expect(JSON.stringify(inserted(TRANSCRIPT_CHUNK_HITS_TABLE))).not.toContain(
		TOKEN,
	);
});

test("a tool output longer than transcript records keep is searched by its stored prefix and tail, and the pass says it was cut", async () => {
	const output = `${"filler line\n".repeat(6_000)}fatal: permission denied (publickey)`;
	const stored = buildTranscriptTextFields(output, {
		keepTail: true,
		textMaxChars: 65_536,
	});
	const { executor, inserted } = storage([
		{
			record_idx: 1,
			text: stored.text,
			head: stored.head,
			tail: stored.tail,
			text_chars: stored.textChars,
		},
	]);

	const outcome = await indexSessionText(session, {
		executor,
		embedder: fakeEmbedder(),
		quota: createMemoryEmbeddingQuota({ tokens: 1e9, windowMs: 86_400_000 }),
	});

	expect(stored.text).not.toContain("permission denied");
	expect(
		inserted(TRANSCRIPT_CHUNKS_TABLE).some((row) =>
			String(row.text).includes("fatal: permission denied (publickey)"),
		),
	).toBe(true);
	expect(outcome).toMatchObject({ status: "written", truncated: 1 });
	expect(
		inserted(TRANSCRIPT_CHUNK_HITS_TABLE).find((row) => row.kind === "receipt"),
	).toMatchObject({ truncated_records: 1 });
});

test("a chunk is stored for each month it appeared in, so a search window reads only its months, and is embedded once", async () => {
	const text = "deploy the billing worker with the new queue";
	const { executor, inserted, upload } = storage([
		{ record_idx: 1, ts: "2026-09-30 23:59:00.000", text },
		{ record_idx: 2, ts: "2026-10-01 00:01:00.000", text },
	]);
	const embedder = fakeEmbedder();
	const quota = createMemoryEmbeddingQuota({
		tokens: 1_000,
		windowMs: 86_400_000,
	});

	await indexSessionText(session, { executor, embedder, quota });
	upload([{ record_idx: 1, ts: "2026-11-02 08:00:00.000", text }]);
	const later = await indexSessionText(
		{ ...session, sessionId: "s-2" },
		{ executor, embedder, quota },
	);

	expect(embedder.texts).toEqual([text]);
	expect(later).toMatchObject({ status: "written", embedded: 0, pending: 0 });
	const rows = inserted(TRANSCRIPT_CHUNKS_TABLE);
	expect(rows.map((row) => row.month).sort()).toEqual([
		"2026-09-01",
		"2026-10-01",
		"2026-11-01",
	]);
	expect(new Set(rows.map((row) => row.chunk_hash)).size).toBe(1);
	expect(rows.every((row) => (row.embedding as number[]).length === 3)).toBe(
		true,
	);
});

test("a session longer than one read is indexed page by page into the same chunks, hits, vectors and receipt as one read", async () => {
	const shared = "rerun the flaky billing test with the retry flag";
	const session100: StoredRecord[] = Array.from({ length: 9 }, (_, index) => ({
		agent_id: index < 6 ? "" : "agent-7",
		record_idx: index + 1,
		ts: index < 4 ? "2026-09-30 23:00:00.000" : "2026-10-01 01:00:00.000",
		text:
			index % 3 === 0
				? shared
				: `${"step output line\n".repeat(90)}distinct tail ${index}`,
	}));
	const run = async (pageRecords: number, embedChunks: number) => {
		const { executor, inserted, recordPages } = storage(session100);
		const embedder = fakeEmbedder();
		const outcome = await indexSessionText(session, {
			executor,
			embedder,
			quota: createMemoryEmbeddingQuota({ tokens: 1e9, windowMs: 86_400_000 }),
			limits: { pageRecords, embedChunks, batchSize: 2 },
			now: () => new Date("2026-10-02T00:00:00.000Z"),
		});
		const rows = (table: string) =>
			inserted(table)
				.map((row) => JSON.stringify(row))
				.sort();
		return {
			outcome,
			pages: recordPages(),
			chunks: rows(TRANSCRIPT_CHUNKS_TABLE),
			hits: rows(TRANSCRIPT_CHUNK_HITS_TABLE),
			embedded: embedder.texts.length,
		};
	};

	for (const embedChunks of [3_000, 5]) {
		const whole = await run(256, embedChunks);
		const paged = await run(2, embedChunks);
		expect(whole.pages).toBe(1);
		expect(paged.pages).toBe(5);
		expect(paged.outcome).toEqual(whole.outcome);
		expect(paged.chunks).toEqual(whole.chunks);
		expect(paged.hits).toEqual(whole.hits);
		expect(paged.embedded).toBe(whole.embedded);
	}
	const capped = await run(2, 5);
	expect(capped.outcome).toMatchObject({ embedded: 5, stopped: "limit" });
	expect(
		capped.chunks.filter((row) => row.includes(`"text":"${shared}"`)),
	).toHaveLength(2);
});

test("a chunk an earlier pass embedded keeps its vector in a month a later page reaches", async () => {
	const text = "migrate the ledger table before the release";
	const { executor, inserted, upload } = storage([
		{ record_idx: 1, ts: "2026-08-15 10:00:00.000", text },
	]);
	const embedder = fakeEmbedder();
	const quota = createMemoryEmbeddingQuota({
		tokens: 1e9,
		windowMs: 86_400_000,
	});
	await indexSessionText(session, { executor, embedder, quota });
	upload([
		{ record_idx: 1, ts: "2026-09-30 23:59:00.000", text },
		{ record_idx: 2, ts: "2026-09-30 23:59:30.000", text: "an unrelated note" },
		{ record_idx: 3, ts: "2026-10-01 00:01:00.000", text },
	]);

	const outcome = await indexSessionText(
		{ ...session, sessionId: "s-2" },
		{ executor, embedder, quota, limits: { pageRecords: 2 } },
	);

	expect(outcome).toMatchObject({ status: "written", embedded: 1, pending: 0 });
	expect(embedder.texts).toEqual([text, "an unrelated note"]);
	const rows = inserted(TRANSCRIPT_CHUNKS_TABLE).filter(
		(row) => row.text === text,
	);
	expect(rows.map((row) => row.month).sort()).toEqual([
		"2026-08-01",
		"2026-09-01",
		"2026-10-01",
	]);
	expect(rows.every((row) => (row.embedding as number[]).length === 3)).toBe(
		true,
	);
});

test("a pass may take longer than its budget when each page gets its own", async () => {
	const records = Array.from({ length: 6 }, (_, index) => ({
		record_idx: index + 1,
		text: `page record ${index}`,
	}));
	const index = (limits: { pageMs: number }) =>
		indexSessionText(session, {
			executor: storage(records, { delayMs: 40 }).executor,
			embedder: null,
			quota: createMemoryEmbeddingQuota({ tokens: 0, windowMs: 86_400_000 }),
			limits: { passMs: 250, pageRecords: 2, ...limits },
		});

	await expect(index({ pageMs: 0 })).rejects.toThrow("deadline");
	expect(await index({ pageMs: 250 })).toMatchObject({
		status: "written",
		chunks: 6,
		hits: 6,
	});
});
