import { afterEach, expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { createSearchAccess } from "./access.js";
import { indexUploadedSessionBestEffort } from "./ingest.js";
import { createMemoryEmbeddingQuota } from "./quota.js";

const ALLOWLIST = "TRANSCRIPT_EMBEDDINGS_WORKSPACES";
const SELF_HOSTED = "OPALINE_SELF_HOSTED";
const saved = {
	[ALLOWLIST]: process.env[ALLOWLIST],
	[SELF_HOSTED]: process.env[SELF_HOSTED],
};
afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

test("only the listed workspaces are indexed", async () => {
	delete process.env[SELF_HOSTED];
	process.env[ALLOWLIST] = "ws-internal";
	const access = createSearchAccess();

	expect(await access.indexes("ws-internal")).toBe(true);
	expect(await access.indexes("ws-other")).toBe(false);
	expect(access.notIndexed).toBe(
		"search is not enabled for this workspace yet: its uploads are not indexed for search",
	);
});

test("a self-hosted server indexes every workspace", async () => {
	process.env[SELF_HOSTED] = "1";
	delete process.env[ALLOWLIST];
	expect(await createSearchAccess().indexes("ws-any")).toBe(true);
});

test("an upload of a workspace that is not listed is not indexed; a listed one's is", async () => {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			return [] as T[];
		},
	};
	delete process.env[SELF_HOSTED];
	process.env[ALLOWLIST] = "ws-listed";
	const access = createSearchAccess();
	const upload = (organizationId: string) =>
		indexUploadedSessionBestEffort(
			executor,
			{
				organizationId,
				userId: "member-1",
				source: "claude_code",
				sessionId: "s-1",
				assertWritable: async () => {},
			},
			{
				access,
				embedder: null,
				quota: createMemoryEmbeddingQuota({ tokens: 10, windowMs: 1_000 }),
			},
		);

	await upload("ws-other");
	expect(statements).toEqual([]);
	await upload("ws-listed");
	expect(statements.length).toBeGreaterThan(0);
	expect(statements[0]?.query_params).toMatchObject({
		organizationId: "ws-listed",
	});
});
