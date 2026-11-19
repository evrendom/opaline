import "../../__tests__/helpers/local-integration-guard.js";
import { afterAll, expect, test } from "bun:test";
import { sqlClient } from "../../db.js";
import { createFileStore } from "./file-store.js";

const prefix = `/local-ingest-test/${crypto.randomUUID()}`;
const store = createFileStore(sqlClient);
const file = {
	path: `${prefix}/.claude/projects/-repo/a.jsonl`,
	source: "claude_code" as const,
	role: "session" as const,
	sessionPath: `${prefix}/.claude/projects/-repo/a.jsonl`,
};
const stat = {
	device: "16777234",
	inode: "123456789",
	size: 4096,
	mtimeMs: 1_762_700_000_123.5,
};

afterAll(async () => {
	await sqlClient.unsafe("DELETE FROM local_ingest_file WHERE path LIKE $1", [
		`${prefix}/%`,
	]);
});

const mine = async () =>
	(await store.loadAll()).filter((row) => row.path.startsWith(prefix));

test("the stored file state reads back with numbers and dates through the API's Postgres client", async () => {
	await store.recordSeen([{ file, stat }]);
	expect(await mine()).toMatchObject([
		{
			...file,
			...stat,
			state: "pending",
			ingestedAt: null,
			nextAttemptAt: null,
			attempts: 0,
		},
	]);
	const at = new Date("2026-11-09T20:00:00.123Z");
	await store.recordIngested({
		files: [
			{ file, stat, headSha256: "h".repeat(64), tailSha256: "t".repeat(64) },
		],
		sessionId: "a",
		organizationId: "org",
		userId: "user",
		state: "ingested",
		reason: null,
		at,
	});
	const [ingested] = await mine();
	expect(ingested).toMatchObject({
		sessionId: "a",
		organizationId: "org",
		userId: "user",
		ingestedSize: 4096,
		ingestedMtimeMs: stat.mtimeMs,
		headSha256: "h".repeat(64),
		ingestedTailSha256: "t".repeat(64),
		state: "ingested",
	});
	expect(ingested?.ingestedAt?.getTime()).toBe(at.getTime());
	const retry = new Date("2026-11-09T20:10:00.000Z");
	await store.recordOutcome({
		paths: [file.path],
		state: "failed",
		reason: "busy",
		nextAttemptAt: retry,
	});
	const [failed] = await mine();
	expect(failed).toMatchObject({
		state: "failed",
		reason: "busy",
		attempts: 1,
	});
	expect(failed?.nextAttemptAt?.getTime()).toBe(retry.getTime());
});
