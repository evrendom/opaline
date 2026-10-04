import { describe, expect, test } from "bun:test";
import {
	createTranscriptRecordsJobGate,
	isTranscriptRecordsCurrent,
	persistTranscriptRecordsBestEffort,
	streamTranscriptRecordDrafts,
} from "./transcript-records-extraction.service.js";
import type { TranscriptRecordsSplitRequest } from "./transcript-records-stream.js";

const SESSION_DATE = "2026-08-01T10:00:00.000Z";

function claudeContent(lines: number): string {
	return Array.from({ length: lines }, (_, index) =>
		JSON.stringify({
			message: { content: `prompt ${index}`, role: "user" },
			timestamp: SESSION_DATE,
			type: "user",
		}),
	).join("\n");
}

function splitRequest(
	content: string,
	overrides: Partial<TranscriptRecordsSplitRequest> = {},
): TranscriptRecordsSplitRequest {
	return {
		batchMaxBytes: 4 * 1024 * 1024,
		batchMaxRows: 2,
		content,
		maxRows: 1_000,
		sessionDate: SESSION_DATE,
		source: "claude_code",
		subagents: {},
		textBudgetChars: 1_000_000,
		textMaxChars: 10_000,
		...overrides,
	};
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
	const collected: T[] = [];
	for await (const value of values) collected.push(value);
	return collected;
}

describe("transcript records job gate", () => {
	test("admits up to the job limit and releases waiters in order", async () => {
		const gate = createTranscriptRecordsJobGate({ maxBytes: 100, maxJobs: 1 });
		const first = await gate.acquire(10);
		const order: string[] = [];
		const second = gate.acquire(10).then((release) => {
			order.push("second");
			return release;
		});
		const third = gate.acquire(10).then((release) => {
			order.push("third");
			return release;
		});

		await Bun.sleep(5);
		expect(order).toEqual([]);
		first?.();
		const secondRelease = await second;
		expect(order).toEqual(["second"]);
		secondRelease?.();
		await third;
		expect(order).toEqual(["second", "third"]);
	});

	test("a session above the standard size waits to run alone instead of being skipped", async () => {
		const MEBIBYTE = 1024 * 1024;
		const gate = createTranscriptRecordsJobGate({
			maxBytes: 256 * MEBIBYTE,
			maxJobs: 2,
		});
		const small = await gate.acquire(MEBIBYTE);
		expect(small).toBeDefined();
		let largeStarted = false;
		const large = gate.acquire(256 * MEBIBYTE).then((release) => {
			largeStarted = true;
			return release;
		});

		await Bun.sleep(5);
		expect(largeStarted).toBe(false);
		expect(await gate.acquire(MEBIBYTE)).toBeUndefined();
		small?.();
		const largeRelease = await large;
		expect(largeRelease).toBeDefined();
		expect(await gate.acquire(MEBIBYTE)).toBeUndefined();
		largeRelease?.();
		const after = await gate.acquire(MEBIBYTE);
		expect(after).toBeDefined();
		after?.();
		expect(await gate.acquire(257 * MEBIBYTE)).toBeUndefined();
	});

	test("queued jobs count against the byte budget like running ones", async () => {
		const gate = createTranscriptRecordsJobGate({ maxBytes: 100, maxJobs: 1 });
		const running = await gate.acquire(60);
		const queued = gate.acquire(30);

		// 60 running + 30 queued leave room for 10 bytes, not for another 60.
		expect(await gate.acquire(60)).toBeUndefined();
		expect(await gate.acquire(11)).toBeUndefined();
		const small = gate.acquire(10);

		running?.();
		const promoted = await queued;
		expect(promoted).toBeFunction();
		promoted?.();
		const last = await small;
		expect(last).toBeFunction();
		last?.();
		const everything = await gate.acquire(100);
		expect(everything).toBeFunction();
		everything?.();
	});

	test("a job larger than the whole budget is rejected outright", async () => {
		const gate = createTranscriptRecordsJobGate({ maxBytes: 100, maxJobs: 1 });

		expect(await gate.acquire(101)).toBeUndefined();
	});

	test("a full wait queue rejects further jobs", async () => {
		const gate = createTranscriptRecordsJobGate({
			maxBytes: 1_000,
			maxJobs: 1,
			maxWaiting: 1,
		});
		const running = await gate.acquire(10);
		const waiting = gate.acquire(10);

		expect(await gate.acquire(10)).toBeUndefined();
		running?.();
		(await waiting)?.();
	});

	test("a cancelled waiter leaves the queue and frees its bytes at once", async () => {
		const gate = createTranscriptRecordsJobGate({ maxBytes: 100, maxJobs: 1 });
		const running = await gate.acquire(60);
		const controller = new AbortController();
		const cancelled = gate.acquire(40, { signal: controller.signal });
		expect(await gate.acquire(40)).toBeUndefined();

		controller.abort();

		expect(await cancelled).toBeUndefined();
		const replacement = gate.acquire(40);
		running?.();
		const promoted = await replacement;
		expect(promoted).toBeFunction();
		promoted?.();
	});

	test("an already aborted signal is never admitted", async () => {
		const gate = createTranscriptRecordsJobGate({ maxBytes: 100, maxJobs: 1 });
		const controller = new AbortController();
		controller.abort();

		expect(
			await gate.acquire(10, { signal: controller.signal }),
		).toBeUndefined();
	});

	test("a waiter that outlasts its deadline is dropped and frees its bytes", async () => {
		const gate = createTranscriptRecordsJobGate({ maxBytes: 100, maxJobs: 1 });
		const running = await gate.acquire(60);

		const expired = await gate.acquire(40, { timeoutMs: 10 });

		expect(expired).toBeUndefined();
		const replacement = gate.acquire(40);
		running?.();
		(await replacement)?.();
	});

	test("a release function frees its slot once", async () => {
		const gate = createTranscriptRecordsJobGate({ maxBytes: 100, maxJobs: 1 });
		const release = await gate.acquire(10);
		release?.();
		release?.();
		const next = await gate.acquire(10);
		const blocked = gate.acquire(10);

		expect(next).toBeFunction();
		next?.();
		expect(await blocked).toBeFunction();
	});
});

describe("streaming transcript drafts from the worker", () => {
	test("hands over every draft in order and then the summary", async () => {
		const stream = streamTranscriptRecordDrafts(
			splitRequest(claudeContent(5)),
			{ timeoutMs: 30_000 },
		);

		const drafts = await collect(stream.drafts);

		expect(drafts.map((draft) => draft.recordIdx)).toEqual([1, 2, 3, 4, 5]);
		expect(stream.summary()).toMatchObject({ lineCount: 5, streamCount: 1 });
	});

	test("an expansion beyond the row cap fails instead of buffering", async () => {
		const tiny = Array.from({ length: 50 }, () => "{}").join("\n");
		const stream = streamTranscriptRecordDrafts(
			splitRequest(tiny, { maxRows: 10 }),
			{ timeoutMs: 30_000 },
		);

		await expect(collect(stream.drafts)).rejects.toThrow(
			"Transcript expands to more than 10 records",
		);
		expect(() => stream.summary()).toThrow("did not complete");
	});

	test("abandoning the stream stops the worker", async () => {
		const stream = streamTranscriptRecordDrafts(
			splitRequest(claudeContent(200), { batchMaxRows: 5 }),
			{ timeoutMs: 30_000 },
		);

		for await (const draft of stream.drafts) {
			expect(draft.recordIdx).toBe(1);
			break;
		}

		expect(() => stream.summary()).toThrow("did not complete");
	});

	test("an aborted signal cancels the extraction", async () => {
		const controller = new AbortController();
		controller.abort();
		const stream = streamTranscriptRecordDrafts(
			splitRequest(claudeContent(3)),
			{ signal: controller.signal, timeoutMs: 30_000 },
		);

		await expect(collect(stream.drafts)).rejects.toThrow("cancelled");
	});
});

describe("best-effort persistence", () => {
	test("reports skipped without touching ClickHouse when the kill switch is off", async () => {
		const outcome = await persistTranscriptRecordsBestEffort(
			{
				close: async () => {},
				execute: async () => {
					throw new Error("must not run");
				},
				insert: async () => {
					throw new Error("must not run");
				},
				query: async () => {
					throw new Error("must not run");
				},
			},
			{
				assertWritable: async () => {},
				config: {
					enabled: false,
					maxRows: 10,
					queueMaxBytes: 1,
					queueMaxJobs: 1,
					textBudgetChars: 1,
					textMaxChars: 1,
					timeoutMs: 1,
				},
				content: "",
				organizationId: "org",
				revision: "1",
				sessionDate: SESSION_DATE,
				sessionId: "session",
				source: "claude_code",
				subagents: {},
				userId: "user",
			},
		);

		expect(outcome).toBe("skipped");
	});

	test("turns every failure into a result and never throws", async () => {
		const outcome = await persistTranscriptRecordsBestEffort(
			{
				close: async () => {},
				execute: async () => {},
				insert: async () => {
					throw new Error("ClickHouse is down");
				},
				query: async () => [],
			},
			{
				assertWritable: async () => {},
				config: {
					enabled: true,
					maxRows: 100,
					queueMaxBytes: 1024 * 1024,
					queueMaxJobs: 1,
					textBudgetChars: 1_000,
					textMaxChars: 1_000,
					timeoutMs: 30_000,
				},
				content: claudeContent(2),
				gate: createTranscriptRecordsJobGate({
					maxBytes: 1024 * 1024,
					maxJobs: 1,
				}),
				organizationId: "org",
				revision: "1",
				sessionDate: SESSION_DATE,
				sessionId: "session",
				source: "claude_code",
				subagents: {},
				userId: "user",
			},
		);

		expect(outcome).toBe("failed");
	});

	test("skips instead of queueing when the process is at its byte budget", async () => {
		const gate = createTranscriptRecordsJobGate({ maxBytes: 10, maxJobs: 1 });

		const outcome = await persistTranscriptRecordsBestEffort(
			{
				close: async () => {},
				execute: async () => {},
				insert: async () => {},
				query: async () => [],
			},
			{
				assertWritable: async () => {},
				config: {
					enabled: true,
					maxRows: 100,
					queueMaxBytes: 10,
					queueMaxJobs: 1,
					textBudgetChars: 1_000,
					textMaxChars: 1_000,
					timeoutMs: 30_000,
				},
				content: claudeContent(5),
				gate,
				organizationId: "org",
				revision: "1",
				sessionDate: SESSION_DATE,
				sessionId: "session",
				source: "claude_code",
				subagents: {},
				userId: "user",
			},
		);

		expect(outcome).toBe("skipped");
	});
});

describe("isTranscriptRecordsCurrent", () => {
	test("a failed receipt lookup is not a current receipt", async () => {
		const current = await isTranscriptRecordsCurrent(
			{
				close: async () => {},
				execute: async () => {},
				insert: async () => {},
				query: async () => {
					throw new Error("ClickHouse is down");
				},
			},
			{
				config: {
					enabled: true,
					maxRows: 100,
					queueMaxBytes: 1024 * 1024,
					queueMaxJobs: 1,
					textBudgetChars: 1_000,
					textMaxChars: 1_000,
					timeoutMs: 30_000,
				},
				content: claudeContent(2),
				organizationId: "org",
				sessionId: "session",
				subagents: {},
				userId: "user",
			},
		);

		expect(current).toBe(false);
	});
});
