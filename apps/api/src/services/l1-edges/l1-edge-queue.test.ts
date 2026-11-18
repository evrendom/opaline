import { afterAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
	type ClaimedL1EdgeScope,
	claimL1EdgeScopes,
	completeL1EdgeScope,
	enqueueL1EdgeScope,
	failL1EdgeScope,
	recordL1EdgeDependencies,
} from "./l1-edge-queue.service.js";
import { sessionCompletion } from "./l1-edge-reconciliation.service.js";

/**
 * The API's shared Postgres client is wrapped by drizzle (db.ts), whose
 * postgres-js driver replaces the date and date-array serializers and
 * parsers with identities. These tests bind every parameter the way that
 * client does, with the serializers of a real (never connected) client
 * passed through drizzle, so a value postgres.js cannot write fails here as
 * it fails against Postgres.
 */
const wrapped = postgres("postgres://edges@127.0.0.1:9/never", {
	prepare: false,
});
drizzle(wrapped);
afterAll(() => wrapped.end({ timeout: 0 }));

const OIDS: Record<string, number> = {
	text: 25,
	"text[]": 1009,
	int: 23,
	smallint: 21,
	bigint: 20,
	timestamptz: 1184,
	"timestamptz[]": 1185,
	jsonb: 3802,
};

/** What postgres.js writes for a parameter cast to `type` (Bind), or why it throws. */
function bind(value: unknown, type: string | undefined): unknown {
	if (value === null) return null;
	const oid = type === undefined ? 0 : OIDS[type];
	const serializers = wrapped.options.serializers as Record<
		number,
		(value: unknown) => unknown
	>;
	const serialize = oid === undefined ? undefined : serializers[oid];
	// Array types without a serializer get one when the connection fetches
	// types (array values only).
	const written = serialize
		? serialize(value)
		: type?.endsWith("[]") && Array.isArray(value)
			? `{${value.join(",")}}`
			: `${value}`;
	// bytes.js `str()` measures the value with Buffer.byteLength.
	Buffer.byteLength(written as string);
	return written;
}

interface Statement {
	query: string;
	params: unknown[];
}

function fakeSql(rows: Record<string, unknown>[] = []) {
	const statements: Statement[] = [];
	const unsafe = async (query: string, params: unknown[] = []) => {
		params.forEach((value, index) => {
			const cast = new RegExp(
				`\\$${index + 1}::([a-z]+(?:\\[\\])?)(?:::([a-z]+(?:\\[\\])?))?`,
			).exec(query);
			bind(value, cast?.[1]);
		});
		statements.push({ query, params });
		return rows;
	};
	const sql = {
		unsafe,
		begin: async (run: (transaction: { unsafe: typeof unsafe }) => unknown) =>
			run({ unsafe }),
	};
	return { sql: sql as unknown as postgres.Sql, statements };
}

const claim: ClaimedL1EdgeScope = {
	organizationId: "org",
	scopeKind: "session",
	scopeId: "u1/claude_code/s1",
	userId: "u1",
	source: "claude_code",
	sessionId: "s1",
	repositoryId: null,
	leaseToken: "lease",
	revision: 12,
	attemptCount: 1,
	input: {},
	coverage: {},
	watermark: null,
	builtRevision: null,
};

describe("edge queue statements bind through the drizzle-wrapped client", () => {
	test("a JS array bound as timestamptz[] is what failed the worker", () => {
		expect(() => bind(["2026-10-08T00:00:00.000Z"], "timestamptz[]")).toThrow(
			'The "string" argument must be of type string',
		);
	});

	test("recording dependencies sends their open times as ISO text", async () => {
		const { sql, statements } = fakeSql();
		await recordL1EdgeDependencies(sql, claim, [
			{ repositoryKey: "101", openUntil: new Date("2026-10-22T00:00:00Z") },
			{
				repositoryKey: "name:someone/else",
				openUntil: new Date("2026-10-22T00:00:00Z"),
			},
		]);
		expect(statements[1]?.params[3]).toEqual([
			"2026-10-22T00:00:00.000Z",
			"2026-10-22T00:00:00.000Z",
		]);
		expect(statements[1]?.query).toContain("until::timestamptz");
	});

	test("enqueue, complete and fail bind without date serializers", async () => {
		const { sql } = fakeSql([{ "?column?": 1 }]);
		await enqueueL1EdgeScope(
			sql,
			{ kind: "repository", organizationId: "org", repositoryId: "101" },
			{ debounceMs: 1_000 },
		);
		await completeL1EdgeScope(sql, claim, {
			resolverVersion: 2,
			input: { generation: null },
			coverage: { "101": { included: true } },
			watermark: new Date("2026-10-08T00:00:00Z"),
			edgeCount: 3,
			unresolvedCount: 0,
		});
		await failL1EdgeScope(sql, claim, "boom", () => 0.5);
	});

	test("a claim reads its watermark as epoch milliseconds, never as a parsed timestamptz", async () => {
		const { sql, statements } = fakeSql([
			{
				...claim,
				revision: "12",
				builtRevision: "11",
				watermarkMs: Date.parse("2026-10-08T00:00:00Z"),
			},
		]);
		const [claimed] = await claimL1EdgeScopes(sql, {
			limit: 4,
			leaseMs: 60_000,
			organizationId: "org",
		});
		expect(claimed?.watermark).toEqual(new Date("2026-10-08T00:00:00Z"));
		expect(claimed?.builtRevision).toBe(11);
		expect(statements[0]?.params[3]).toBe("org");
		expect(statements[0]?.query).not.toMatch(/scope\.watermark[,\s]/u);
	});

	test("a freeze keeps the build it retains: revision, time, rules, input and coverage", async () => {
		// Build 7 completed; build 8 wrote rows and failed; build 9 freezes.
		const frozen = sessionCompletion({
			written: false,
			frozenReason: "transcript generation expired; edges kept",
			input: { generation: null },
			coverage: {},
			edgeCount: 0,
			unresolvedCount: 0,
		});
		expect(frozen).toMatchObject({ retainBuild: true });
		expect(frozen.input).toBeUndefined();
		expect(frozen.coverage).toBeUndefined();
		const { sql, statements } = fakeSql([{ "?column?": 1 }]);
		await completeL1EdgeScope(sql, { ...claim, revision: 9 }, frozen);
		const [update] = statements;
		expect(update?.params[11]).toBe(true);
		for (const kept of [
			"built_revision = CASE WHEN $12::boolean THEN built_revision",
			"built_at = CASE WHEN $12::boolean THEN built_at",
			"resolver_version = CASE WHEN $12::boolean THEN resolver_version",
			"input = CASE WHEN $12::boolean THEN input",
			"coverage = CASE WHEN $12::boolean THEN coverage",
		])
			expect(update?.query).toContain(kept);
		// A written build publishes itself.
		expect(
			sessionCompletion({
				written: true,
				frozenReason: null,
				input: { truncated: false },
				coverage: {},
				edgeCount: 3,
				unresolvedCount: 0,
			}).retainBuild,
		).toBeUndefined();
	});
});
