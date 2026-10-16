import { describe, expect, test } from "bun:test";
import {
	decodeTranscriptRecordsReceipt,
	encodeTranscriptRecordsReceipt,
	NO_TRANSCRIPT_RECORD_FACTS,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptRecordDraft,
} from "@rudel/api-routes/transcript-records";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
	hasMatchingTranscriptRecordsReceipt,
	noRecordFacts,
	TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
	writeTranscriptRecords,
} from "./transcript-records-ingest.service.js";
import { TRANSCRIPT_READ_DEADLINE_MS } from "./transcript-records-reader.service.js";

const identity = {
	organizationId: "org",
	revision: "1234567890123456",
	sessionDate: "2026-08-20T10:00:00.000Z",
	sessionId: "session",
	source: "claude_code" as const,
	userId: "user",
};

const draft: TranscriptRecordDraft = {
	agentId: "",
	blockIdx: 1,
	byteLen: 42,
	byteStart: 9_007_199_254,
	callId: "call",
	commandClass: "test",
	exitCode: 2,
	facts: {
		...NO_TRANSCRIPT_RECORD_FACTS,
		agentVersion: "2.1.292",
		entrypoint: "sdk-ts",
		gitOperation: ["push"],
		interrupted: false,
		extra: { "git.push.branch": "main", stdout_chars: "12" },
	},
	fileOp: "",
	filePath: "",
	head: "head",
	isError: true,
	kind: "tool_result",
	recordIdx: 7,
	recordUuid: "5e0c1a52-8d0b-4f7e-9a51-3c2f6b1d9e47",
	spawnedAgentId: "",
	subtype: "",
	tail: "tail",
	text: "text",
	textChars: 4,
	toolName: "Bash",
	ts: "2026-08-20T10:00:01.234Z",
	turnIdx: 3,
};

describe("transcript record rows", () => {
	test("map a draft to table columns with ClickHouse-ready values", () => {
		expect(buildTranscriptRecordRow(identity, draft)).toEqual({
			...noRecordFacts(),
			agent_version: "2.1.292",
			entrypoint: "sdk-ts",
			git_operation: ["push"],
			interrupted: false,
			facts: { "git.push.branch": "main", stdout_chars: "12" },
			agent_id: "",
			block_idx: 1,
			byte_len: 42,
			byte_start: "9007199254",
			call_id: "call",
			command_class: "test",
			exit_code: 2,
			file_op: "",
			file_path: "",
			head: "head",
			is_error: true,
			kind: "tool_result",
			organization_id: "org",
			parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
			record_idx: 7,
			record_uuid: "5e0c1a52-8d0b-4f7e-9a51-3c2f6b1d9e47",
			revision: "1234567890123456",
			session_date: "2026-08-20 10:00:00.000",
			session_id: "session",
			source: "claude_code",
			spawned_agent_id: "",
			subtype: "",
			tail: "tail",
			text: "text",
			text_chars: 4,
			tool_name: "Bash",
			ts: "2026-08-20 10:00:01.234",
			turn_idx: 3,
			user_id: "user",
		});
	});

	test("the receipt row sits at the reserved index and carries the receipt in head", () => {
		const row = buildTranscriptRecordsReceiptRow(identity, {
			contentSha256: "abc",
			lineCount: 10,
			oversizedLineCount: 0,
			parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
			publishedAt: "2026-09-30T10:00:00.000Z",
			rowCount: 12,
			streamCount: 2,
			textTruncated: false,
			unparseableLineCount: 1,
		});

		expect(row).toMatchObject({
			agent_id: "",
			block_idx: 0,
			kind: "receipt",
			record_idx: 4_294_967_295,
			revision: "1234567890123456",
		});
		expect(decodeTranscriptRecordsReceipt(row.head)).toMatchObject({
			contentSha256: "abc",
			rowCount: 12,
			streamCount: 2,
		});
	});

	test("rejects malformed timestamps instead of writing a bad row", () => {
		expect(() =>
			buildTranscriptRecordRow(identity, { ...draft, ts: "not a date" }),
		).toThrow("Invalid transcript record timestamp");
	});
});

describe("content hash and receipt matching", () => {
	test("the hash covers subagents independent of key order", () => {
		const first = hashTranscriptContent("main", { a: "1", b: "2" });
		const reordered = hashTranscriptContent("main", { b: "2", a: "1" });
		const changed = hashTranscriptContent("main", { a: "1", b: "3" });

		expect(first).toBe(reordered);
		expect(first).not.toBe(changed);
		expect(first).not.toBe(hashTranscriptContent("main"));
	});

	test("a receipt matches only the same content and parser version", () => {
		const state = {
			receipt: {
				contentSha256: "abc",
				lineCount: 1,
				oversizedLineCount: 0,
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: "2026-09-30T10:00:00.000Z",
				rowCount: 1,
				streamCount: 1,
				textTruncated: false,
				unparseableLineCount: 0,
			},
			parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
			revision: "5",
		};

		expect(
			hasMatchingTranscriptRecordsReceipt(state, { contentSha256: "abc" }),
		).toBe(true);
		expect(
			hasMatchingTranscriptRecordsReceipt(state, { contentSha256: "xyz" }),
		).toBe(false);
		expect(
			hasMatchingTranscriptRecordsReceipt(null, { contentSha256: "abc" }),
		).toBe(false);
		expect(
			hasMatchingTranscriptRecordsReceipt(
				{ ...state, receipt: { ...state.receipt, parserVersion: 0 } },
				{ contentSha256: "abc" },
			),
		).toBe(false);
		expect(
			hasMatchingTranscriptRecordsReceipt(state, {
				contentSha256: "abc",
				revision: "6",
			}),
		).toBe(false);
	});
});

const NOW = new Date("2026-09-30T12:00:00.000Z");

function receiptHead(revision: string, publishedAt: Date): string {
	return encodeTranscriptRecordsReceipt({
		contentSha256: "abc",
		lineCount: 1,
		oversizedLineCount: 0,
		parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
		publishedAt: publishedAt.toISOString(),
		rowCount: Number(revision),
		streamCount: 1,
		textTruncated: false,
		unparseableLineCount: 0,
	});
}

function minutesBefore(minutes: number): Date {
	return new Date(NOW.getTime() - minutes * 60_000);
}

interface FakeGeneration {
	parser_version: number;
	receipt_head: string;
	revision_text: string;
}

function committed(revision: string, publishedAt: Date): FakeGeneration {
	return {
		parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
		receipt_head: receiptHead(revision, publishedAt),
		revision_text: revision,
	};
}

function uncommitted(revision: string): FakeGeneration {
	return {
		parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
		receipt_head: "",
		revision_text: revision,
	};
}

/**
 * A ClickHouse stand-in that remembers insert deduplication tokens the way the
 * server does: a repeated token drops the insert, even after the rows were
 * deleted. Rows are keyed by identity, like a merged ReplacingMergeTree.
 */
function createFakeExecutor(
	options: {
		readonly generations?: readonly FakeGeneration[];
		readonly queryFails?: boolean;
	} = {},
) {
	const events: string[] = [];
	const executed: ClickHouseStatement[] = [];
	const seenTokens = new Set<string>();
	const stored = new Map<string, Record<string, unknown>>();
	const inserts: {
		deduplicationToken?: string;
		table: string;
		values: object[];
	}[] = [];
	const executor: ClickHouseExecutor = {
		async close() {},
		async execute(statement) {
			events.push("delete");
			executed.push(statement);
			const revision = statement.query_params?.revision;
			if (
				typeof statement.query === "string" &&
				statement.query.includes("revision = {revision:UInt64}")
			) {
				for (const [key, row] of stored) {
					if (String(row.revision) === String(revision)) stored.delete(key);
				}
			}
		},
		async insert(params) {
			events.push("insert");
			inserts.push(params);
			const token = params.deduplicationToken;
			if (token !== undefined && seenTokens.has(token)) return;
			if (token !== undefined) seenTokens.add(token);
			for (const value of params.values) {
				const row = value as Record<string, unknown>;
				stored.set(
					[
						row.revision,
						row.parser_version,
						row.agent_id,
						row.record_idx,
						row.block_idx,
					].join("\u0000"),
					row,
				);
			}
		},
		async query<T>() {
			if (options.queryFails) throw new Error("cleanup query failed");
			return [...(options.generations ?? [])] as T[];
		},
	};
	const storedRecords = () =>
		[...stored.values()].filter((row) => row.kind !== "receipt");
	return { events, executed, executor, inserts, storedRecords };
}

async function* drafts(count: number): AsyncGenerator<TranscriptRecordDraft> {
	for (let index = 1; index <= count; index++) {
		yield { ...draft, recordIdx: index };
	}
}

function writeInput(
	assertWritable: () => Promise<void>,
	extra: Partial<Parameters<typeof writeTranscriptRecords>[1]> = {},
): Parameters<typeof writeTranscriptRecords>[1] {
	const count = 3;
	return {
		assertWritable,
		contentSha256: "abc",
		drafts: drafts(count),
		now: () => NOW,
		organizationId: identity.organizationId,
		revision: "200",
		sessionDate: identity.sessionDate,
		sessionId: identity.sessionId,
		source: identity.source,
		summary: () => ({
			lineCount: count,
			oversizedLineCount: 0,
			rowCount: count,
			streamCount: 1,
			textTruncated: false,
			unparseableLineCount: 0,
		}),
		userId: identity.userId,
		...extra,
	};
}

describe("writing one extraction generation", () => {
	test("checks the fence before every insert and publishes the receipt last", async () => {
		const fake = createFakeExecutor();
		let checks = 0;

		const result = await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {
				checks++;
				fake.events.push("fence");
			}),
		);

		expect(result).toEqual({ batchCount: 1, rowCount: 3 });
		expect(fake.events).toEqual(["fence", "insert", "fence", "insert"]);
		expect(checks).toBe(2);
		const receipt = fake.inserts.at(-1)?.values[0];
		expect(receipt).toMatchObject({
			kind: "receipt",
			parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
			revision: "200",
		});
		const head = (receipt as { head: string }).head;
		expect(decodeTranscriptRecordsReceipt(head)?.publishedAt).toBe(
			NOW.toISOString(),
		);
	});

	test("stores each distinct received setup text once, behind the fence and before the receipt", async () => {
		const fake = createFakeExecutor();
		const text = (sha256: string, body: string) => ({
			sha256,
			text: body,
			chars: body.length,
			cut: false,
		});
		async function* withSetup(): AsyncGenerator<TranscriptRecordDraft> {
			yield { ...draft, recordIdx: 1, setupTexts: [text("a1", "Use bun.")] };
			yield {
				...draft,
				recordIdx: 2,
				setupTexts: [text("a1", "Use bun."), text("b2", "Run tests.")],
			};
		}

		await writeTranscriptRecords(
			fake.executor,
			writeInput(
				async () => {
					fake.events.push("fence");
				},
				{ drafts: withSetup() },
			),
		);

		expect(fake.inserts.map((insert) => insert.table)).toEqual([
			"rudel.transcript_records",
			"rudel.setup_texts",
			"rudel.transcript_records",
		]);
		expect(fake.events).toEqual([
			"fence",
			"insert",
			"fence",
			"insert",
			"fence",
			"insert",
		]);
		expect(fake.inserts[1]?.values).toEqual([
			{
				organization_id: "org",
				user_id: "user",
				version: "a1",
				chars: 8,
				text: "Use bun.",
				text_cut: false,
				written_at: "2026-09-30 12:00:00.000",
			},
			{
				organization_id: "org",
				user_id: "user",
				version: "b2",
				chars: 10,
				text: "Run tests.",
				text_cut: false,
				written_at: "2026-09-30 12:00:00.000",
			},
		]);
	});

	test("a confirmed fence after rows were written removes that generation", async () => {
		const fake = createFakeExecutor();
		let checks = 0;
		const fenced = new ClickHouseWriteFencedError();

		await expect(
			writeTranscriptRecords(
				fake.executor,
				writeInput(async () => {
					checks++;
					if (checks === 2) throw fenced;
				}),
			),
		).rejects.toBe(fenced);

		expect(fake.inserts).toHaveLength(1);
		expect(fake.executed).toHaveLength(1);
		expect(fake.executed[0]?.query).toContain("DELETE FROM");
		expect(fake.executed[0]?.query_params).toMatchObject({
			parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
			revision: "200",
			sessionId: identity.sessionId,
		});
		expect(fake.storedRecords()).toHaveLength(0);
	});

	test("a confirmed fence before the first insert writes and deletes nothing", async () => {
		const fake = createFakeExecutor();

		await expect(
			writeTranscriptRecords(
				fake.executor,
				writeInput(async () => {
					throw new ClickHouseWriteFencedError();
				}),
			),
		).rejects.toBeInstanceOf(ClickHouseWriteFencedError);

		expect(fake.inserts).toHaveLength(0);
		expect(fake.executed).toHaveLength(0);
	});

	test("a transient fence lookup failure keeps the written rows and the retry converges", async () => {
		const fake = createFakeExecutor();
		let checks = 0;

		await expect(
			writeTranscriptRecords(
				fake.executor,
				writeInput(async () => {
					checks++;
					if (checks === 2) throw new Error("Postgres connection reset");
				}),
			),
		).rejects.toThrow("Postgres connection reset");

		expect(fake.executed).toHaveLength(0);
		expect(fake.storedRecords()).toHaveLength(3);

		const retry = await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {}),
		);

		expect(retry.rowCount).toBe(3);
		expect(fake.storedRecords()).toHaveLength(3);
	});

	test("rebuilding a fence-deleted generation is not suppressed by remembered insert tokens", async () => {
		const fake = createFakeExecutor();
		let checks = 0;

		await expect(
			writeTranscriptRecords(
				fake.executor,
				writeInput(async () => {
					checks++;
					if (checks === 2) throw new ClickHouseWriteFencedError();
				}),
			),
		).rejects.toBeInstanceOf(ClickHouseWriteFencedError);
		expect(fake.storedRecords()).toHaveLength(0);

		const rebuilt = await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {}),
		);

		expect(rebuilt.rowCount).toBe(3);
		expect(fake.storedRecords()).toHaveLength(3);
	});

	test("reusing an attempt id after a delete would drop the rebuilt rows", async () => {
		const fake = createFakeExecutor();
		let checks = 0;
		const sameAttempt = { attemptId: "shared-attempt" };

		await expect(
			writeTranscriptRecords(
				fake.executor,
				writeInput(async () => {
					checks++;
					if (checks === 2) throw new ClickHouseWriteFencedError();
				}, sameAttempt),
			),
		).rejects.toBeInstanceOf(ClickHouseWriteFencedError);
		await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {}, sameAttempt),
		);

		expect(fake.storedRecords().length).toBeLessThan(3);
	});

	test("generations never share a row identity", () => {
		const first = buildTranscriptRecordRow(identity, draft);
		const newer = buildTranscriptRecordRow(
			{ ...identity, revision: "1234567890123457" },
			draft,
		);
		const identityOf = (row: typeof first) =>
			[
				row.organization_id,
				row.user_id,
				row.session_id,
				row.revision,
				row.parser_version,
				row.agent_id,
				row.record_idx,
				row.block_idx,
			].join("\u0000");

		expect(identityOf(first)).not.toBe(identityOf(newer));
	});
});

describe("retiring superseded generations", () => {
	function retiredRevisions(fake: ReturnType<typeof createFakeExecutor>) {
		const statement = fake.executed.at(-1);
		const params = statement?.query_params ?? {};
		return Object.entries(params)
			.filter(([key]) => /^revision\d+$/u.test(key))
			.map(([, value]) => String(value));
	}

	test("the retirement grace outlasts the enforced whole-read deadline", () => {
		expect(TRANSCRIPT_RECORDS_RETIRE_GRACE_MS).toBeGreaterThan(
			TRANSCRIPT_READ_DEADLINE_MS,
		);
	});

	test("crashed attempts go immediately and a just-superseded generation stays", async () => {
		const fake = createFakeExecutor({
			generations: [uncommitted("150"), committed("100", minutesBefore(1))],
		});

		await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {}),
		);

		expect(retiredRevisions(fake)).toEqual(["150"]);
	});

	test("a committed generation goes only after the grace since it was superseded", async () => {
		const fake = createFakeExecutor({
			generations: [
				committed("150", minutesBefore(30)),
				committed("100", minutesBefore(60)),
				committed("50", minutesBefore(90)),
			],
		});

		await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {}),
		);

		// 150 was superseded just now by 200 and stays. 100 was superseded 30 min
		// ago by 150 and 50 was superseded 60 min ago by 100: both are past the
		// 10 minute grace.
		expect(retiredRevisions(fake)).toEqual(["100", "50"]);
	});

	test("nothing is deleted while every older generation is inside its grace", async () => {
		const fake = createFakeExecutor({
			generations: [
				committed("150", minutesBefore(3)),
				committed("100", minutesBefore(5)),
			],
		});

		await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {}),
		);

		expect(fake.executed).toHaveLength(0);
	});

	test("a zero grace retires every superseded committed generation", async () => {
		const fake = createFakeExecutor({
			generations: [
				committed("150", minutesBefore(0)),
				committed("100", minutesBefore(0)),
			],
		});

		await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {}, { retireGraceMs: 0 }),
		);

		expect(retiredRevisions(fake)).toEqual(["150", "100"]);
	});

	test("a cleanup failure never fails a committed write", async () => {
		const fake = createFakeExecutor({ queryFails: true });

		const result = await writeTranscriptRecords(
			fake.executor,
			writeInput(async () => {}),
		);

		expect(result.rowCount).toBe(3);
		expect(fake.executed).toHaveLength(0);
	});
});
