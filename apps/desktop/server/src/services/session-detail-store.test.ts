import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionDetailBodyStore } from "./session-detail-body-store.js";
import type { SessionDetailDerivation } from "./session-detail-derivation.service.js";
import {
	pruneStoredSessionDetails,
	readStoredSessionDetail,
	sessionDetailStoreDirectory,
	writeStoredSessionDetail,
} from "./session-detail-store.js";

let dataDir: string;
let env: Record<string, string>;

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "detail-store-"));
	env = { OPALINE_SELF_HOSTED: "1", OPALINE_DATA_DIR: dataDir };
});

afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

const key = {
	organizationId: "org",
	ownerId: "user",
	revision: "42",
	sessionId: "session",
	source: "claude_code",
};

function derivation(): SessionDetailDerivation {
	const turn = { id: "t1", items: [{ kind: "text", text: "hello" }] };
	return {
		byteSize: 1234,
		revision: "42",
		rawSubagents: { a1: '{"type":"user"}\n' },
		turnSummaries: [{ id: "t1", n: 1 }],
		turnBodies: createSessionDetailBodyStore([["t1", turn]], (value) => value),
	} as unknown as SessionDetailDerivation;
}

test("only a self-hosted server with a data directory keeps derived details", () => {
	expect(sessionDetailStoreDirectory(env)).toBe(
		join(dataDir, "session-detail"),
	);
	expect(sessionDetailStoreDirectory({ OPALINE_DATA_DIR: dataDir })).toBeNull();
	expect(sessionDetailStoreDirectory({ OPALINE_SELF_HOSTED: "1" })).toBeNull();
	expect(
		sessionDetailStoreDirectory({ ...env, OPALINE_DETAIL_STORE: "0" }),
	).toBeNull();
});

test("a stored derivation reads back for its own key only", async () => {
	expect(await writeStoredSessionDetail(key, derivation(), env)).toBe(true);
	const read = await readStoredSessionDetail(key, env);
	expect(read?.byteSize).toBe(1234);
	expect(read?.rawSubagents).toEqual({ a1: '{"type":"user"}\n' });
	expect((read as unknown as { turnSummaries: unknown }).turnSummaries).toEqual(
		[{ id: "t1", n: 1 }],
	);
	expect(
		await readStoredSessionDetail({ ...key, revision: "43" }, env),
	).toBeNull();
	expect(
		await readStoredSessionDetail({ ...key, ownerId: "other" }, env),
	).toBeNull();
	expect(
		await readStoredSessionDetail(key, { OPALINE_DATA_DIR: dataDir }),
	).toBeNull();
});

test("a damaged file is dropped instead of served", async () => {
	await writeStoredSessionDetail(key, derivation(), env);
	const directory = join(dataDir, "session-detail");
	const [shard] = await readdir(directory);
	const [file] = await readdir(join(directory, shard ?? ""));
	await writeFile(join(directory, shard ?? "", file ?? ""), "not a derivation");
	expect(await readStoredSessionDetail(key, env)).toBeNull();
	expect(await readdir(join(directory, shard ?? ""))).toEqual([]);
});

test("pruning keeps the store under its byte limit, least recently used first", async () => {
	const directory = join(dataDir, "session-detail");
	for (const revision of ["1", "2", "3"]) {
		await writeStoredSessionDetail({ ...key, revision }, derivation(), env);
		await Bun.sleep(20);
	}
	await readStoredSessionDetail({ ...key, revision: "1" }, env);
	const [shard] = await readdir(directory);
	const sizes: number[] = [];
	for (const name of await readdir(directory))
		for (const file of await readdir(join(directory, name)))
			sizes.push(
				(await Bun.file(join(directory, name, file)).arrayBuffer()).byteLength,
			);
	expect(shard).toBeDefined();
	const largest = Math.max(...sizes);
	expect(await pruneStoredSessionDetails(directory, 2 * largest)).toBe(1);
	expect(
		await readStoredSessionDetail({ ...key, revision: "2" }, env),
	).toBeNull();
	expect(
		await readStoredSessionDetail({ ...key, revision: "1" }, env),
	).not.toBeNull();
	expect(
		await readStoredSessionDetail({ ...key, revision: "3" }, env),
	).not.toBeNull();
});
