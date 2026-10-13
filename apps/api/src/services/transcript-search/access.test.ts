import { afterEach, expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { createSearchAccess } from "./access.js";
import { indexUploadedSessionBestEffort } from "./ingest.js";
import { createMemoryEmbeddingQuota } from "./quota.js";

/**
 * Which workspaces' uploads are indexed for search: the internal workspaces
 * TRANSCRIPT_EMBEDDINGS_WORKSPACES lists and, only with
 * TRANSCRIPT_EMBEDDINGS_PAID_PLANS=true, those with a paid subscription
 * (active or past due). The subscription lookup is a stand-in for Postgres
 * that counts its calls.
 */

const ALLOWLIST = "TRANSCRIPT_EMBEDDINGS_WORKSPACES";
const PAID_PLANS = "TRANSCRIPT_EMBEDDINGS_PAID_PLANS";
const saved = {
	[ALLOWLIST]: process.env[ALLOWLIST],
	[PAID_PLANS]: process.env[PAID_PLANS],
};
afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

function subscriptions(statuses: Record<string, string>) {
	const lookups: string[] = [];
	return {
		lookups,
		statuses,
		subscriptionStatus: async (workspaceId: string) => {
			lookups.push(workspaceId);
			return statuses[workspaceId] ?? null;
		},
	};
}

test("by default only the listed workspaces are indexed: a paid plan is not enough, and no subscription is looked up", async () => {
	process.env[ALLOWLIST] = "ws-internal";
	delete process.env[PAID_PLANS];
	const billing = subscriptions({
		"ws-active": "active",
		"ws-past-due": "past_due",
	});
	const access = createSearchAccess(billing);

	expect(await access.indexes("ws-internal")).toBe(true);
	expect(await access.indexes("ws-active")).toBe(false);
	expect(await access.indexes("ws-past-due")).toBe(false);
	expect(billing.lookups).toEqual([]);
	expect(access.notIndexed).toBe(
		"search is not enabled for this workspace yet: its uploads are not indexed for search",
	);
});

test("only exactly true turns paid plans on", async () => {
	process.env[ALLOWLIST] = "";
	const billing = subscriptions({ "ws-active": "active" });

	process.env[PAID_PLANS] = "1";
	expect(await createSearchAccess(billing).indexes("ws-active")).toBe(false);
	process.env[PAID_PLANS] = "true";
	const access = createSearchAccess(billing);
	expect(await access.indexes("ws-active")).toBe(true);
	expect(access.notIndexed).toContain("search is available on paid plans");
});

test("with paid plans on, a workspace is indexed while its subscription is active or past due, or when it is listed as internal; any other is not", async () => {
	process.env[ALLOWLIST] = "ws-internal";
	process.env[PAID_PLANS] = "true";
	const billing = subscriptions({
		"ws-active": "active",
		"ws-past-due": "past_due",
		"ws-trialing": "trialing",
		"ws-canceled": "canceled",
	});
	const access = createSearchAccess(billing);

	const indexed = async (workspaceId: string) => access.indexes(workspaceId);

	expect(await indexed("ws-active")).toBe(true);
	expect(await indexed("ws-past-due")).toBe(true);
	expect(await indexed("ws-trialing")).toBe(false);
	expect(await indexed("ws-canceled")).toBe(false);
	expect(await indexed("ws-free")).toBe(false);
	expect(await indexed("ws-internal")).toBe(true);
	expect(billing.lookups).not.toContain("ws-internal");
});

test("the subscription is looked up once a minute at most, so a workspace that stops paying stops being indexed within a minute", async () => {
	let now = 0;
	const billing = subscriptions({ "ws-team": "active" });
	const access = createSearchAccess(billing, {
		now: () => now,
		paidPlans: true,
	});

	expect(await access.indexes("ws-team")).toBe(true);
	billing.statuses["ws-team"] = "canceled";
	now = 30_000;
	expect(await access.indexes("ws-team")).toBe(true);
	now = 61_000;
	expect(await access.indexes("ws-team")).toBe(false);
	expect(billing.lookups).toEqual(["ws-team", "ws-team"]);
});

test("with paid plans on, an upload of a workspace without a paid plan is not indexed; a paid one's is", async () => {
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
	const access = createSearchAccess(
		subscriptions({ "ws-paid": "active", "ws-free": "canceled" }),
		{ paidPlans: true },
	);
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

	await upload("ws-free");
	expect(statements).toEqual([]);
	await upload("ws-paid");
	expect(statements.length).toBeGreaterThan(0);
	expect(statements[0]?.query_params).toMatchObject({
		organizationId: "ws-paid",
	});
});
