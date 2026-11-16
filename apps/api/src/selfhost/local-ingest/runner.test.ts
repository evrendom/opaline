import { expect, test } from "bun:test";
import type { SessionImportOutcome } from "../../services/session-import/index.js";
import type { SessionOutcome } from "./service.js";

process.env.PG_CONNECTION_STRING ??= "postgres://unused@127.0.0.1:1/unused";
const { createSessionRunner } = await import("./runner.js");

const files = [
	{
		device: "1",
		inode: "2",
		size: 10,
		mtimeMs: 3,
		headSha256: "head",
		tailSha256: "tail",
	},
];

function run(outcomes: SessionImportOutcome[]) {
	const sleeps: number[] = [];
	const runner = createSessionRunner({
		importSession: async () => {
			const next = outcomes.shift();
			if (!next) throw new Error("no outcome left");
			return next;
		},
		prepare: async () => ({
			kind: "ready",
			input: {
				source: "claude_code",
				sessionId: "session-1",
				projectPath: "/repo",
				content: "{}",
			},
			bytes: 2,
			images: [],
			files,
		}),
		sql: (() => {
			throw new Error("no sql");
		}) as never,
		clickhouse: () => {
			throw new Error("no clickhouse");
		},
		objectStore: () => null,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
	});
	return {
		sleeps,
		outcome: (): Promise<SessionOutcome> =>
			runner(
				{
					sessionPath: "/s.jsonl",
					source: "claude_code",
					change: { kind: "whole", reason: "new", since: null },
				},
				{ organizationId: "org", userId: "user" },
			),
	};
}

test("a full queue is waited out, then the import's outcome is the session's", async () => {
	const runner = run([
		{ kind: "retry", reason: "queue_full", message: "busy" },
		{ kind: "retry", reason: "queue_full", message: "busy" },
		{
			kind: "kept",
			reason: "shorter_than_stored",
			message: "Replacement transcript is unexpectedly smaller",
		},
	]);
	expect(await runner.outcome()).toEqual({
		kind: "kept",
		sessionId: "session-1",
		bytes: 0,
		reason:
			"The transcript on disk is shorter than the copy Opaline stored; the longer copy is kept.",
		files,
	});
	expect(runner.sleeps).toEqual([250, 250]);
});

test("stored, skipped and failed imports become ingested, skipped and retry", async () => {
	expect(await run([{ kind: "stored", usage: "complete" }]).outcome()).toEqual({
		kind: "ingested",
		sessionId: "session-1",
		bytes: 2,
		files,
	});
	expect(
		await run([{ kind: "stored", usage: "incomplete" }]).outcome(),
	).toMatchObject({
		kind: "ingested",
		reason:
			"Stored without its usage: the transcript's token counts are incomplete. It is imported again when the file changes.",
	});
	expect(
		await run([
			{
				kind: "skipped",
				reason: "ownership_conflict",
				message: "Session belongs to another organization member",
			},
		]).outcome(),
	).toEqual({
		kind: "skipped",
		reason: "Session belongs to another organization member",
		files,
	});
	expect(
		await run([{ kind: "retry", reason: "failed", message: "down" }]).outcome(),
	).toEqual({ kind: "retry", reason: "down", files });
});
