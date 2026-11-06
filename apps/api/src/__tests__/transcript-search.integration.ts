import "./helpers/local-integration-guard.js";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import { runSql, type SqlCaller } from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import {
	enqueueClickHousePurge,
	runClickHousePurgeWorkerPass,
} from "../services/clickhouse-purge.service.js";
import { runNodeId } from "../services/l1-edges/l1-edge-ids.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";
import { createSearchAccess } from "../services/transcript-search/access.js";
import type { TranscriptEmbedder } from "../services/transcript-search/config.js";
import {
	createMemoryEmbeddingQuota,
	createPostgresEmbeddingQuota,
	type EmbeddingQuota,
} from "../services/transcript-search/quota.js";
import {
	createSqlSearchFunction,
	type SearchEnv,
	searchTranscripts,
} from "../services/transcript-search/search.js";
import { indexSessionText } from "../services/transcript-search/session-index.service.js";
import { deleteUserPostgresData } from "../services/user-deletion.service.js";

/** Every agent query gets a slot at once. */
const unlimitedSlots: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

/**
 * Transcript search against real ClickHouse and Postgres, OpenAI replaced by
 * a fake embedder: an uploaded session's text is chunked, deduplicated and
 * embedded once, the search tool and search('…') in sql find its runs by
 * meaning and by exact string, a workspace over its OpenAI quota stops
 * embedding and says so, and the account and workspace purges remove what
 * search stored.
 */

setDefaultTimeout(180_000);
// Its own client: another suite in this process may close the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `search_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const thriftyWorkspace = `${RUN}_ws_quota`;
const rebuiltWorkspace = `${RUN}_ws_rebuilt`;
const unindexedWorkspace = `${RUN}_ws_unindexed`;
const userId = `${RUN}_user`;
const clickhouse = getClickhouse();
const SEARCH_TABLES = [
	"rudel.transcript_chunks",
	"rudel.transcript_chunk_hits",
];

const AUTH_FILE = [
	"     1\texport function login(user: User, token: string) {",
	"     2\t\tif (!verifyToken(token)) throw new AuthError('expired');",
	"     3\t\treturn createSession(user);",
	"     4\t}",
].join("\n");

/**
 * A fake of text-embedding-3-small: one dimension per word stem, so texts
 * that share words point the same way. It records every text it embedded.
 */
function fakeEmbedder(): TranscriptEmbedder & { texts: string[] } {
	const texts: string[] = [];
	return {
		texts,
		model: "fake-word-stems@512",
		async embed(input) {
			texts.push(...input);
			return {
				vectors: input.map((text) => {
					const vector = new Array<number>(512).fill(0);
					for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
						let hash = 0;
						for (const character of word.slice(0, 4))
							hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
						vector[hash % 512] = (vector[hash % 512] ?? 0) + 1;
					}
					return vector;
				}),
				tokens: input.reduce((sum, text) => sum + text.length, 0),
			};
		},
	};
}

/** A Claude Code session: three runs, the file read in two of them, a build with a flag. */
function claudeSession(
	sessionId: string,
	minutesAgo: number,
	reminder?: string,
): string {
	let minute = 0;
	const line = (entry: Record<string, unknown>) =>
		JSON.stringify({
			sessionId,
			cwd: "/repo",
			version: "2.1.292",
			userType: "external",
			isSidechain: false,
			timestamp: new Date(
				Date.now() - (minutesAgo - minute++) * 60_000,
			).toISOString(),
			...entry,
		});
	const prompt = (text: string) =>
		line({ type: "user", message: { role: "user", content: text } });
	const call = (id: string, name: string, input: Record<string, unknown>) =>
		line({
			type: "assistant",
			message: {
				role: "assistant",
				content: [{ type: "tool_use", id, name, input }],
			},
		});
	const result = (id: string, content: string) =>
		line({
			type: "user",
			message: {
				role: "user",
				content: [{ type: "tool_result", tool_use_id: id, content }],
			},
		});
	const say = (text: string) =>
		line({
			type: "assistant",
			message: { role: "assistant", content: [{ type: "text", text }] },
		});
	return [
		prompt("The login test keeps failing on CI, please fix it"),
		call("t1", "Read", { file_path: "/repo/src/auth.ts" }),
		result("t1", AUTH_FILE),
		say("I changed the token check in auth.ts so the session is created."),
		prompt("now run the build with the old bundler"),
		call("t2", "Bash", { command: "bun run build --legacy" }),
		result("t2", "Build finished in 4.2s"),
		call("t3", "Read", { file_path: "/repo/src/auth.ts" }),
		result("t3", AUTH_FILE),
		prompt("check auth.ts once more"),
		call("t4", "Read", { file_path: "/repo/src/auth.ts" }),
		result("t4", AUTH_FILE),
		...(reminder
			? [prompt(`<system-reminder>${reminder}</system-reminder>`)]
			: []),
	].join("\n");
}

/** Publishes the session's transcript records and its run index, as upload and the worker do. */
async function upload(
	organizationId: string,
	sessionId: string,
	revision = "1",
	options: { runIndex: boolean; reminder?: string } = { runIndex: true },
) {
	const sessionDate = new Date(Date.now() - 3_600_000).toISOString();
	const identity = {
		organizationId,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision,
		sessionDate,
	};
	const content = claudeSession(sessionId, 50, options.reminder);
	const stats = createSplitStats();
	const drafts = [
		...splitSessionTranscript(
			{ content, sessionDate, source: "claude_code" },
			stats,
		),
	];
	const rows = drafts.map((draft) => buildTranscriptRecordRow(identity, draft));
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(content),
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
		],
	});
	if (!options.runIndex) return;
	await buildRunIndex({
		executor: clickhouse,
		organizationId,
		session: { userId, source: "claude_code", sessionId },
		buildRevision: Number(revision),
		beforeWrite: async () => {},
	});
}

function index(
	organizationId: string,
	sessionId: string,
	embedder: TranscriptEmbedder | null,
	quota: EmbeddingQuota,
) {
	return indexSessionText(
		{
			organizationId,
			userId,
			source: "claude_code",
			sessionId,
			assertWritable: async () => {},
		},
		{ executor: clickhouse, embedder, quota },
	);
}

/** Every workspace of this suite is indexed as if on a paid plan. */
const access = createSearchAccess(
	{ subscriptionStatus: async () => "active" },
	{ paidPlans: true },
);

const countRows = async (table: string, column: string, value: string) => {
	const [row] = await clickhouse.query<{ rows: string }>({
		query: `SELECT toString(count()) AS rows FROM ${table} WHERE ${column} = {value:String}`,
		query_params: { value },
	});
	return Number(row?.rows ?? 0);
};

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		...SEARCH_TABLES,
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id IN ({workspaces:Array(String)}) SETTINGS lightweight_deletes_sync = 2`,
			query_params: {
				workspaces: [
					workspace,
					thriftyWorkspace,
					rebuiltWorkspace,
					unindexedWorkspace,
				],
			},
		});
	await sqlClient`DELETE FROM clickhouse_purge_job WHERE target_id IN (${userId}, ${thriftyWorkspace})`;
	await sqlClient`DELETE FROM organization WHERE id IN (${workspace}, ${thriftyWorkspace})`;
	await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
	await sqlClient.end();
});

describe("search over uploaded transcripts", () => {
	const embedder = fakeEmbedder();
	const quota = createMemoryEmbeddingQuota({
		tokens: 1_000_000,
		windowMs: 86_400_000,
	});
	const caller: SqlCaller = {
		workspaceId: workspace,
		reader: { userId, role: "member", ownSessionsOnly: false },
	};
	const env: SearchEnv = {
		executor: clickhouse,
		quota,
		sqlQuota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
		limiter: unlimitedSlots,
		embedderFor: () => embedder,
		access,
	};
	const first = `${RUN}_first`;
	const second = `${RUN}_second`;
	/** The run that starts at a record: turn 2 starts at the session's fifth line. */
	const runId = (sessionId: string, startRecord: number) =>
		runNodeId({ userId, source: "claude_code", sessionId }, "", startRecord);

	test("a file read many times, in two sessions, is embedded once; indexing the same upload again embeds nothing", async () => {
		await upload(workspace, first);
		await upload(workspace, second);

		const indexed = await index(workspace, first, embedder, quota);
		expect(indexed).toMatchObject({ status: "written", pending: 0 });
		expect(await index(workspace, second, embedder, quota)).toMatchObject({
			status: "written",
			embedded: 0,
			pending: 0,
		});
		expect(await index(workspace, first, embedder, quota)).toEqual({
			status: "current",
		});

		expect(
			embedder.texts.filter((text) => text === AUTH_FILE.trim()),
		).toHaveLength(1);
		expect(new Set(embedder.texts).size).toBe(embedder.texts.length);
		expect(embedder.texts).toContain(
			"The login test keeps failing on CI, please fix it",
		);
		expect((await quota.usage(workspace)).used).toBe(
			embedder.texts.reduce((sum, text) => sum + text.length, 0),
		);
	});

	test("a meaning query and an exact flag query each return the run that holds them, with its id, why it matched and a snippet", async () => {
		const meaning = await searchTranscripts(
			caller,
			{ text: "fix failing login test", mode: "meaning" },
			env,
		);
		if (!meaning.ok) throw new Error(meaning.error.message);
		expect(meaning.result.results[0]).toMatchObject({
			sessionId: expect.stringContaining(`${RUN}_`),
			agentId: "",
			turn: 1,
			snippet: "The login test keeps failing on CI, please fix it",
		});
		expect(meaning.result.results[0]?.why).toStartWith("meaning ");
		expect(meaning.result.results[0]?.why).toContain(" in user_prompt");

		const exact = await searchTranscripts(
			caller,
			{ text: "--LEGACY", mode: "hybrid" },
			env,
		);
		if (!exact.ok) throw new Error(exact.error.message);
		const found = exact.result.results.filter((result) =>
			result.why.includes("exact ×1 in tool_call"),
		);
		expect(found.map((result) => [result.runId, result.turn]).sort()).toEqual(
			[
				[runId(first, 5), 2],
				[runId(second, 5), 2],
			].sort(),
		);
		expect(found[0]?.snippet).toContain("bun run build --legacy");
		expect(exact.result).toMatchObject({
			mode: "hybrid",
			coverage: { sessions: 2, searched: 2, indexed: 2, pending: 0 },
			exactMatches: { runs: 2, sessions: 2 },
			suggestion: null,
		});
		expect(exact.result.quota?.usedTokens).toBeGreaterThan(0);
	});

	test("nothing found suggests a rewrite", async () => {
		const outcome = await searchTranscripts(
			caller,
			{ text: "flaky payment webhook", mode: "exact" },
			env,
		);
		if (!outcome.ok) throw new Error(outcome.error.message);
		expect(outcome.result.results).toEqual([]);
		expect(outcome.result.suggestion).toContain(
			'No run contains "flaky payment webhook" exactly.',
		);
	});

	test("search() works inside sql, combined with filters on runs", async () => {
		const sqlEnv = {
			executor: clickhouse,
			results: createMemorySqlResultStore(),
			limiter: unlimitedSlots,
			githubRepositories: async () => [],
			quota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
			functions: [createSqlSearchFunction(env)],
		};
		const query = (turnFilter: string) =>
			runSql(
				caller,
				{
					query: `SELECT r.session_id AS session_id, r.turn_idx AS turn_idx, s.why AS why FROM search('--legacy', 'exact') AS s JOIN runs AS r USING (run_id) WHERE ${turnFilter} ORDER BY r.session_id`,
					title: "Runs that built with --legacy",
				},
				sqlEnv,
			);
		const matched = await query("r.turn_idx >= 2");
		if (!matched.ok) throw new Error(matched.error.message);
		expect(matched.result.table.split("\n")).toEqual([
			"session_id | turn_idx | why",
			`${first} | 2 | exact ×1 in tool_call`,
			`${second} | 2 | exact ×1 in tool_call`,
		]);
		const filtered = await query("r.turn_idx = 1");
		if (!filtered.ok) throw new Error(filtered.error.message);
		expect(filtered.result.rows).toBe(0);
	});

	test("every SQL example in the plugin skill pages runs in ClickHouse through the sql gateway", async () => {
		const skillDir = join(
			import.meta.dir,
			"../../../../plugins/opaline/skills/opaline",
		);
		const pages = await Array.fromAsync(
			new Bun.Glob("**/*.md").scan({ cwd: skillDir }),
		);
		const texts = await Promise.all(
			pages.map((page) => Bun.file(join(skillDir, page)).text()),
		);
		const examples = texts.flatMap((text) =>
			[...text.matchAll(/```sql\n([\s\S]*?)```/gu)].map(
				(match) => match[1] ?? "",
			),
		);
		const sqlEnv = {
			executor: clickhouse,
			results: createMemorySqlResultStore(),
			limiter: unlimitedSlots,
			githubRepositories: async () => [],
			quota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
			functions: [createSqlSearchFunction(env)],
		};
		const failed: { query: string; error: string }[] = [];
		for (const query of examples) {
			const outcome = await runSql(
				caller,
				{ query, title: "Skill example" },
				sqlEnv,
			);
			if (!outcome.ok) failed.push({ query, error: outcome.error.message });
		}
		expect(examples.length).toBeGreaterThanOrEqual(6);
		expect(failed).toEqual([]);
	});
});

describe("re-uploads", () => {
	test("a session is indexed from its newest generation, compared as numbers, and older generations' hits are retired", async () => {
		const embedder = fakeEmbedder();
		const quota = createMemoryEmbeddingQuota({
			tokens: 1_000_000,
			windowMs: 86_400_000,
		});
		const sessionId = `${RUN}_reuploaded`;
		await upload(workspace, sessionId, "9");
		expect(await index(workspace, sessionId, embedder, quota)).toMatchObject({
			status: "written",
		});
		await upload(workspace, sessionId, "10");

		expect(await index(workspace, sessionId, embedder, quota)).toMatchObject({
			status: "written",
			embedded: 0,
		});
		expect(await index(workspace, sessionId, embedder, quota)).toEqual({
			status: "current",
		});
		const generations = await clickhouse.query<{ revision: string }>({
			query: `SELECT DISTINCT toString(revision) AS revision FROM rudel.transcript_chunk_hits
				WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String}`,
			query_params: { organizationId: workspace, sessionId },
		});
		expect(generations).toEqual([{ revision: "10" }]);
	});
});

describe("a re-upload the run index has not caught up with", () => {
	test("exact search reads the generation of the committed build; its new generation's hits match no run of the older build, and coverage says the session is not indexed", async () => {
		const embedder = fakeEmbedder();
		const quota = createMemoryEmbeddingQuota({
			tokens: 1_000_000,
			windowMs: 86_400_000,
		});
		const sessionId = `${RUN}_rebuilt`;
		const env: SearchEnv = {
			executor: clickhouse,
			quota,
			sqlQuota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
			limiter: unlimitedSlots,
			embedderFor: () => embedder,
			access,
		};
		const caller: SqlCaller = {
			workspaceId: rebuiltWorkspace,
			reader: { userId, role: "member", ownSessionsOnly: false },
		};
		const search = async (
			text: string,
			mode: "exact" | "meaning",
			since: string,
		) => {
			const outcome = await searchTranscripts(
				caller,
				{ text, mode, filters: { since } },
				env,
			);
			if (!outcome.ok) throw new Error(outcome.error.message);
			return outcome.result;
		};
		const yesterday = new Date(Date.now() - 86_400_000)
			.toISOString()
			.slice(0, 10);
		const dayBefore = new Date(Date.parse(yesterday) - 86_400_000)
			.toISOString()
			.slice(0, 10);
		await upload(rebuiltWorkspace, sessionId, "1");
		await upload(rebuiltWorkspace, sessionId, "2", { runIndex: false });
		expect(
			await index(rebuiltWorkspace, sessionId, embedder, quota),
		).toMatchObject({ status: "written" });

		// Windows of different days: each counts its coverage afresh.
		const stale = await search("--legacy", "exact", yesterday);
		expect(stale.results.map((result) => result.turn)).toEqual([2]);
		expect(stale.coverage).toEqual({
			sessions: 1,
			searched: 1,
			partial: 0,
			indexed: 0,
			pending: 0,
		});
		expect(
			(await search("bun run build legacy", "meaning", yesterday)).results,
		).toEqual([]);

		await buildRunIndex({
			executor: clickhouse,
			organizationId: rebuiltWorkspace,
			session: { userId, source: "claude_code", sessionId },
			buildRevision: 2,
			beforeWrite: async () => {},
		});
		const caughtUp = await search("bun run build legacy", "meaning", dayBefore);
		expect(caughtUp.results.map((result) => result.turn)).toContain(2);
		expect(caughtUp.coverage).toMatchObject({ sessions: 1, indexed: 1 });
	});
});

describe("a session never indexed for meaning", () => {
	test("is found by exact string and by regex in its stored records; injected context is hidden unless asked for, and counted", async () => {
		const sessionId = `${RUN}_unindexed`;
		await upload(unindexedWorkspace, sessionId, "1", {
			runIndex: true,
			reminder: "Never push to the release branch from here.",
		});
		const env: SearchEnv = {
			executor: clickhouse,
			quota: createMemoryEmbeddingQuota({ tokens: 0, windowMs: 86_400_000 }),
			sqlQuota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
			limiter: unlimitedSlots,
			embedderFor: () => null,
			access,
		};
		const caller: SqlCaller = {
			workspaceId: unindexedWorkspace,
			reader: { userId, role: "member", ownSessionsOnly: false },
		};
		const search = async (input: Parameters<typeof searchTranscripts>[1]) => {
			const outcome = await searchTranscripts(caller, input, env);
			if (!outcome.ok) throw new Error(outcome.error.message);
			return outcome.result;
		};

		const exact = await search({ text: "BUILD --LEGACY", mode: "hybrid" });
		expect(exact).toMatchObject({
			mode: "exact",
			coverage: { sessions: 1, searched: 1, indexed: 0 },
			exactMatches: { runs: 1, sessions: 1 },
		});
		expect(exact.results).toHaveLength(1);
		expect(exact.results[0]).toMatchObject({
			sessionId,
			turn: 2,
			why: "exact ×1 in tool_call",
		});
		expect(exact.results[0]?.snippet).toContain("bun run build --legacy");

		const regex = await search({
			text: "build --(legacy|modern)",
			mode: "regex",
		});
		expect(regex.results.map((result) => [result.turn, result.why])).toEqual([
			[2, "regex ×1 in tool_call"],
		]);
		expect(
			(await search({ text: "BUILD --(legacy)", mode: "regex" })).results,
		).toEqual([]);

		const hidden = await search({ text: "release branch", mode: "exact" });
		expect(hidden.results).toEqual([]);
		expect(hidden.hiddenInjected).toEqual({ matches: 1, runs: 1 });
		const shown = await search({
			text: "release branch",
			mode: "exact",
			filters: { includeInjected: true },
		});
		expect(shown.results.map((result) => [result.turn, result.why])).toEqual([
			[3, "exact ×1 in injected_context"],
		]);
		expect(shown.hiddenInjected).toEqual({ matches: 0, runs: 0 });

		const sqlEnv = {
			executor: clickhouse,
			results: createMemorySqlResultStore(),
			limiter: unlimitedSlots,
			githubRepositories: async () => [],
			quota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
			functions: [createSqlSearchFunction(env)],
		};
		const inSql = await runSql(
			caller,
			{
				query:
					"SELECT r.turn_idx AS turn_idx, s.why AS why FROM search('build --(legacy|modern)', 'regex') AS s JOIN runs AS r USING (run_id)",
				title: "Builds with a bundler flag",
			},
			sqlEnv,
		);
		if (!inSql.ok) throw new Error(inSql.error.message);
		expect(inSql.result.table.split("\n")).toEqual([
			"turn_idx | why",
			"2 | regex ×1 in tool_call",
		]);
	});
});

describe("the OpenAI quota", () => {
	test("a workspace over its quota stops embedding, stays searchable by exact string, and search says so", async () => {
		await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${thriftyWorkspace}, ${thriftyWorkspace}, ${thriftyWorkspace})`;
		const quota = createPostgresEmbeddingQuota(sqlClient, {
			tokens: 10,
			windowMs: 86_400_000,
		});
		await quota.charge(thriftyWorkspace, 4);
		await quota.charge(thriftyWorkspace, 6);
		expect(await quota.usage(thriftyWorkspace)).toMatchObject({
			used: 10,
			limit: 10,
		});
		const embedder = fakeEmbedder();
		const sessionId = `${RUN}_thrifty`;
		await upload(thriftyWorkspace, sessionId);

		const outcome = await index(thriftyWorkspace, sessionId, embedder, quota);

		expect(outcome).toMatchObject({ status: "written", stopped: "quota" });
		expect(embedder.texts).toEqual([]);
		const searched = await searchTranscripts(
			{
				workspaceId: thriftyWorkspace,
				reader: { userId, role: "member", ownSessionsOnly: true },
			},
			{ text: "--legacy", mode: "hybrid" },
			{
				executor: clickhouse,
				quota,
				sqlQuota: createMemorySqlQuota({ queries: 10, windowMs: 3_600_000 }),
				limiter: unlimitedSlots,
				embedderFor: () => embedder,
				access,
			},
		);
		if (!searched.ok) throw new Error(searched.error.message);
		expect(searched.result).toMatchObject({
			requestedMode: "hybrid",
			mode: "exact",
			coverage: { sessions: 1, indexed: 1, pending: 1 },
			quota: { usedTokens: 10, limitTokens: 10 },
		});
		expect(searched.result.results.map((result) => result.turn)).toEqual([2]);
		expect(searched.result.notices[0]).toStartWith(
			"only exact matches: search by meaning is not available (the workspace used its OpenAI quota of 10 tokens",
		);
		expect(embedder.texts).toEqual([]);
	});
});

describe("deletion", () => {
	test("deleting the account removes its chunks and hits; deleting the workspace removes the workspace's", async () => {
		await sqlClient`INSERT INTO "user" (id, name, email) VALUES (${userId}, ${userId}, ${`${userId}@example.com`})`;
		for (const table of SEARCH_TABLES)
			expect(await countRows(table, "user_id", userId)).toBeGreaterThan(0);

		await deleteUserPostgresData(userId, { sqlClient });
		await purgeUntilDone({ targetType: "account", targetId: userId });
		for (const table of SEARCH_TABLES)
			expect(await countRows(table, "user_id", userId)).toBe(0);

		// Rows a workspace still holds after its members are gone go with it.
		await clickhouse.insert({
			table: "rudel.transcript_chunks",
			asyncInsert: false,
			values: [
				{
					organization_id: thriftyWorkspace,
					user_id: `${RUN}_former`,
					month: "2026-10-01",
					chunk_hash: "0".repeat(32),
					text: "left behind",
					embedding: [],
					model: "",
					embedded_at: "1970-01-01 00:00:00.000",
				},
			],
		});
		await sqlClient.begin(async (transaction) => {
			await enqueueClickHousePurge(
				{ targetId: thriftyWorkspace, targetType: "organization" },
				transaction,
			);
			await transaction.unsafe("DELETE FROM organization WHERE id = $1", [
				thriftyWorkspace,
			]);
		});
		await purgeUntilDone({
			targetType: "organization",
			targetId: thriftyWorkspace,
		});
		for (const table of SEARCH_TABLES)
			expect(await countRows(table, "organization_id", thriftyWorkspace)).toBe(
				0,
			);
		const [quota] = await sqlClient`
			SELECT 1 FROM transcript_embedding_quota WHERE organization_id = ${thriftyWorkspace}
		`;
		expect(quota).toBeUndefined();
	});
});

/** Runs purge passes until the target's purge succeeded; other suites may have jobs queued first. */
async function purgeUntilDone(target: {
	targetType: "account" | "organization";
	targetId: string;
}) {
	for (let pass = 0; pass < 20; pass++) {
		await runClickHousePurgeWorkerPass({ resend: {}, sqlClient });
		const [job] = await sqlClient<{ status: string }[]>`
			SELECT status FROM clickhouse_purge_job
			WHERE target_type = ${target.targetType} AND target_id = ${target.targetId}
		`;
		if (job?.status === "succeeded") return;
	}
	throw new Error(`The ${target.targetType} purge did not succeed`);
}
