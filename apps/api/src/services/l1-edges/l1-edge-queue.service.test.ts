import { describe, expect, test } from "bun:test";
import { sessionScopeId } from "./l1-edge-ids.js";
import {
	enqueueL1EdgeDependents,
	enqueueL1EdgeScope,
	l1EdgeScopeId,
} from "./l1-edge-queue.service.js";

/** A Postgres stand-in that records each statement and its parameters. */
function recordingSql() {
	const calls: { query: string; params: unknown[] }[] = [];
	const sql = {
		unsafe: async (query: string, params: unknown[] = []) => {
			calls.push({ query, params });
			return [];
		},
	} as unknown as Parameters<typeof enqueueL1EdgeScope>[0];
	return { sql, calls };
}

const session = {
	organizationId: "org",
	userId: "u/1",
	source: "codex",
	sessionId: "s 1",
};

describe("the run index scope", () => {
	test("is queued as a session's own scope, with its session columns and id", async () => {
		const { sql, calls } = recordingSql();
		await enqueueL1EdgeScope(
			sql,
			{ kind: "run_index", ...session },
			{ debounceMs: 120_000 },
		);
		expect(calls[0]?.params).toEqual([
			"org",
			["run_index"],
			sessionScopeId(session),
			"u/1",
			"codex",
			"s 1",
			null,
			0,
			120_000,
		]);
		expect(l1EdgeScopeId({ kind: "run_index", ...session })).toBe(
			l1EdgeScopeId({ kind: "session", ...session }),
		);
	});

	test("upload paths never wait on the queue for the run index", async () => {
		// Usage writes and transcript-records publication run inside uploads;
		// the worker (after a session's edges) and the census queue the run
		// index instead.
		for (const path of [
			"../usage-event-ingest.service.ts",
			"../transcript-records-ingest.service.ts",
		])
			expect(
				await Bun.file(new URL(path, import.meta.url)).text(),
			).not.toContain("l1-edge");
		// The edges request that extraction awaits queues only the session's edges.
		expect(
			await Bun.file(new URL("./l1-edge-enqueue.ts", import.meta.url)).text(),
		).not.toContain('kind: "run_index"');
	});

	test("repository changes re-queue session edges only, never the run index", async () => {
		const { sql, calls } = recordingSql();
		await enqueueL1EdgeDependents(sql, "org", ["101"], { limit: 10 });
		expect(calls[0]?.query).toContain("scope.scope_kind = 'session'");
		expect(calls[0]?.query).not.toContain("run_index");
	});
});
