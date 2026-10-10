import { afterEach, describe, expect, test } from "bun:test";
import type postgres from "postgres";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	buildObservedSessionsStatement,
	classifySessionScope,
	requeueStaleL1EdgeScopes,
	type SessionScopeState,
} from "./l1-edge-census.service.js";
import { L1_EDGE_RESOLVER_VERSION } from "./l1-edge-derivation.js";
import { sessionScopeId } from "./l1-edge-ids.js";

const generation = {
	revision: "10",
	parserVersion: 1032,
	transcriptParserVersion: 8,
};
const built = (
	overrides: Partial<SessionScopeState> = {},
): SessionScopeState => ({
	scope_id: "s",
	built: true,
	pending: false,
	resolver_version: L1_EDGE_RESOLVER_VERSION,
	frozen_reason: null,
	input: { generation, transcript: null, truncated: false },
	...overrides,
});

describe("classifySessionScope", () => {
	test("names why a scope needs a build", () => {
		expect(classifySessionScope(undefined, generation)).toBe("missing");
		expect(classifySessionScope(built({ built: false }), generation)).toBe(
			"unbuilt",
		);
		expect(
			classifySessionScope(built({ resolver_version: 1 }), generation),
		).toBe("resolver_version");
		expect(
			classifySessionScope(built(), { ...generation, revision: "11" }),
		).toBe("generation");
		expect(classifySessionScope(built({ input: {} }), generation)).toBe(
			"generation",
		);
	});

	test("leaves current, waiting and frozen scopes alone", () => {
		expect(classifySessionScope(built(), generation)).toBeNull();
		// Found by captures only: no generation to compare.
		expect(classifySessionScope(built(), null)).toBeNull();
		expect(classifySessionScope(built({ pending: true }), generation)).toBe(
			"waiting",
		);
		expect(
			classifySessionScope(
				built({ frozen_reason: "transcript generation expired; edges kept" }),
				{ ...generation, revision: "11" },
			),
		).toBeNull();
	});
});

const observed = (sessionId: string, organizationId = "org") => ({
	organization_id: organizationId,
	user_id: "u",
	source: "claude_code",
	session_id: sessionId,
	revision_text: generation.revision,
	parser_version: generation.parserVersion,
	transcript_parser_version: generation.transcriptParserVersion,
});

function fakes(input: {
	observed: ReturnType<typeof observed>[];
	captured?: {
		organization_id: string;
		user_id: string;
		source: string;
		session_id: string;
	}[];
	repositories?: { organization_id: string; repository_id: string }[];
	scopes?: SessionScopeState[];
}) {
	const statements: ClickHouseStatement[] = [];
	const executor = {
		async query(statement: ClickHouseStatement) {
			statements.push(statement);
			return input.observed;
		},
	} as unknown as ClickHouseExecutor;
	const calls: { query: string; params: unknown[] }[] = [];
	const sql = {
		unsafe: async (query: string, params: unknown[] = []) => {
			calls.push({ query, params });
			if (query.includes("FROM github_repository_binding"))
				return input.repositories ?? [];
			if (query.includes("FROM repository_evidence_capture"))
				return input.captured ?? [];
			if (query.includes("FROM l1_edge_scope")) {
				const ids = params[1] as string[];
				return (input.scopes ?? []).filter((scope) =>
					ids.includes(scope.scope_id),
				);
			}
			if (query.includes("unnest($3::text[]")) return params[2] as string[];
			return [];
		},
	} as unknown as postgres.Sql;
	const inserts = () =>
		calls.filter((call) => call.query.includes("INSERT INTO l1_edge_scope"));
	return { executor, sql, calls, statements, inserts };
}

const deadline = (remainingMs = 30_000) => {
	const now = Date.parse("2026-10-09T03:00:00.000Z");
	return { deadlineAt: now + remainingMs, now: () => now };
};

describe("requeueStaleL1EdgeScopes", () => {
	afterEach(() => {
		delete process.env.L1_EDGES_ENQUEUE_ENABLED;
	});

	test("queues missing and stale session scopes and missing repository scopes at backfill priority", async () => {
		const scope = (sessionId: string) =>
			sessionScopeId({ userId: "u", source: "claude_code", sessionId });
		const fake = fakes({
			observed: [
				observed("missing"),
				observed("current"),
				observed("waiting"),
				observed("stale"),
			],
			captured: [
				{
					organization_id: "org",
					user_id: "u",
					source: "codex",
					session_id: "captured",
				},
			],
			repositories: [{ organization_id: "org", repository_id: "101" }],
			scopes: [
				built({ scope_id: scope("current") }),
				built({ scope_id: scope("waiting"), pending: true }),
				built({ scope_id: scope("stale"), resolver_version: 1 }),
			],
		});
		const result = await requeueStaleL1EdgeScopes({
			sql: fake.sql,
			executor: fake.executor,
			deadline: deadline(),
		});
		expect(result).toMatchObject({
			enabled: true,
			sessionCandidates: 5,
			sessionsQueued: 3,
			alreadyQueued: 1,
			repositoriesQueued: 1,
			byReason: { missing: 2, resolver_version: 1 },
			hasMore: false,
		});
		const [repository, sessions] = fake.inserts();
		expect(repository?.params.slice(0, 3)).toEqual([
			"org",
			["repository"],
			"101",
		]);
		expect(repository?.params[7]).toBe(1);
		expect(sessions?.params[1]).toBe("session");
		expect((sessions?.params[2] as string[]).sort()).toEqual(
			[
				scope("missing"),
				scope("stale"),
				sessionScopeId({ userId: "u", source: "codex", sessionId: "captured" }),
			].sort(),
		);
		expect(sessions?.params[6]).toBe(1);
	});

	test("is bounded: at most 500 sessions per run, the rest next time", async () => {
		const fake = fakes({
			observed: Array.from({ length: 600 }, (_, index) =>
				observed(`s${index}`),
			),
		});
		const result = await requeueStaleL1EdgeScopes({
			sql: fake.sql,
			executor: fake.executor,
			deadline: deadline(),
		});
		expect(result).toMatchObject({ sessionsQueued: 500, hasMore: true });
		expect(fake.statements[0]?.clickhouse_settings).toMatchObject({
			max_result_rows: "2000",
			result_overflow_mode: "throw",
		});
	});

	test("queues nothing once the deadline is near", async () => {
		const fake = fakes({
			observed: [observed("a")],
			repositories: [{ organization_id: "org", repository_id: "101" }],
		});
		const result = await requeueStaleL1EdgeScopes({
			sql: fake.sql,
			executor: fake.executor,
			deadline: deadline(1_000),
		});
		expect(result).toMatchObject({
			sessionsQueued: 0,
			repositoriesQueued: 0,
			hasMore: true,
		});
		expect(fake.inserts()).toEqual([]);
	});

	test("does nothing while edge requests are switched off", async () => {
		process.env.L1_EDGES_ENQUEUE_ENABLED = "false";
		const fake = fakes({ observed: [observed("a")] });
		const result = await requeueStaleL1EdgeScopes({
			sql: fake.sql,
			executor: fake.executor,
			deadline: deadline(),
		});
		expect(result.enabled).toBe(false);
		expect(fake.calls).toEqual([]);
		expect(fake.statements).toEqual([]);
	});

	test("reads recent observation receipts in a daily-rotating order", () => {
		const now = Date.parse("2026-10-09T03:00:00.000Z");
		const { query, query_params } = buildObservedSessionsStatement(now, "org");
		expect(query).toContain("kind = 'receipt'");
		expect(query).toContain("AND organization_id = {organizationId:String}");
		expect(query_params).toMatchObject({
			seed: "2026-10-09",
			since: now - 14 * 86_400_000,
			limit: 2_000,
		});
	});

	test("upload paths never run the census", async () => {
		for (const path of [
			"../git-observation-extraction.service.ts",
			"../transcript-records-ingest.service.ts",
			"../repository-evidence.service.ts",
			"./l1-edge-enqueue.ts",
		])
			expect(
				await Bun.file(new URL(path, import.meta.url)).text(),
			).not.toContain("l1-edge-census");
	});
});
