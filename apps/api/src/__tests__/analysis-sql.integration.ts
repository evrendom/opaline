import "./helpers/local-integration-guard.js";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import {
	createAgentQueryLimiter,
	createPostgresAgentQuerySlots,
} from "../services/analysis/agent-query-slots.js";
import { RUN_INDEX_VERSION } from "../services/analysis/run-index-sql.js";
import {
	describeSchema,
	runSql,
	type SqlCaller,
	type SqlOutcome,
} from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
	createPostgresSqlQuota,
	createPostgresSqlResultStore,
	expireSqlResults,
} from "../services/analysis/sql-results.js";
import {
	recordQuery,
	saveAnalysis,
	shareAnalysis,
} from "../services/analysis-log/analysis-log.service.js";
import { createLocalEmbedder } from "../services/analysis-log/embedder.js";
import type { FindingImpact } from "../services/analysis-log/finding-impact.js";
import {
	createClickHouseFindingImpact,
	createPostgresFindingImpactFence,
} from "../services/analysis-log/finding-impact-clickhouse.js";
import { createPostgresVisibilitySyncs } from "../services/analysis-log/finding-visibility.js";
import { createMemoryAnalysisStore } from "../services/analysis-log/memory-store.js";
import type { AnalysisViewer } from "../services/analysis-log/types.js";
import {
	enqueueClickHousePurge,
	runClickHousePurgeWorkerPass,
} from "../services/clickhouse-purge.service.js";
import { deleteUserPostgresData } from "../services/user-deletion.service.js";

/**
 * The SQL gateway against real ClickHouse and Postgres: the runs view's
 * contract (one row per run of each session's committed build, only the
 * caller's sessions), and stored results removed by the account and
 * workspace purges.
 */

setDefaultTimeout(60_000);
// Its own client: another suite in this process closes the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});

const RUN = `analysis_sql_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const otherWorkspace = `${RUN}_ws_other`;
const memberId = `${RUN}_member`;
const colleagueId = `${RUN}_colleague`;
const adminId = `${RUN}_admin`;
const clickhouse = getClickhouse();
/** A member of a workspace that keeps members to their own sessions. */
const member: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: memberId, role: "member", ownSessionsOnly: true },
};
/** An admin of that workspace. */
const admin: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: adminId, role: "admin", ownSessionsOnly: true },
};
/** A member of a workspace with the default visibility: every member's sessions. */
const teammate: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: memberId, role: "member", ownSessionsOnly: false },
};
const env = () => ({
	executor: clickhouse,
	results: createMemorySqlResultStore(),
	quota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
	limiter: createAgentQueryLimiter(createPostgresAgentQuerySlots(sqlClient)),
	githubRepositories: async () => [],
});

const at = (daysAgo: number) =>
	new Date(Date.now() - daysAgo * 86_400_000)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");

interface Seed {
	organization: string;
	user: string;
	session: string;
	revision: string;
	build: string;
	/**
	 * Runs as [turn, active minutes, cost, output tokens]; a receipt commits
	 * the build when set.
	 */
	runs: [number, number, number?, number?][];
	receipt: boolean;
	daysAgo?: number;
}

async function seed(rows: readonly Seed[]) {
	await clickhouse.insert({
		table: "rudel.run_index",
		asyncInsert: false,
		values: rows.flatMap((row) => [
			...row.runs.map(([turn, active, cost, outputTokens]) => ({
				organization_id: row.organization,
				user_id: row.user,
				session_id: row.session,
				revision: row.revision,
				parser_version: 9,
				index_version: RUN_INDEX_VERSION,
				build_revision: row.build,
				row_kind: "run",
				start_record: turn * 10,
				turn_idx: turn,
				source: "claude_code",
				session_date: at(row.daysAgo ?? 1),
				started_at: at(row.daysAgo ?? 1),
				ended_at: at(row.daysAgo ?? 1),
				active_minutes: active,
				minutes: active,
				cost_usd: cost ?? null,
				output_tokens: outputTokens ?? null,
				built_at: at(0),
			})),
			...(row.receipt
				? [
						{
							organization_id: row.organization,
							user_id: row.user,
							session_id: row.session,
							revision: row.revision,
							parser_version: 9,
							index_version: RUN_INDEX_VERSION,
							build_revision: row.build,
							row_kind: "receipt",
							start_record: 4_294_967_295,
							source: "claude_code",
							session_date: at(row.daysAgo ?? 1),
							started_at: at(row.daysAgo ?? 1),
							ended_at: at(row.daysAgo ?? 1),
							built_at: at(0),
						},
					]
				: []),
		]),
	});
}

function ok(outcome: SqlOutcome) {
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result;
}

const RANKING = `SELECT session_id, turn_idx, active_minutes FROM runs
	WHERE started_at >= now() - INTERVAL 30 DAY
	ORDER BY active_minutes DESC`;

// The workspaces exist in Postgres too: a query holds a slot keyed by its workspace.
beforeAll(async () => {
	for (const organization of [workspace, otherWorkspace])
		await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${organization}, ${organization}, ${organization})`;
});

afterAll(async () => {
	for (const organization of [workspace, otherWorkspace])
		await sqlClient`DELETE FROM organization WHERE id = ${organization}`;
	await sqlClient.end();
	for (const organization of [
		workspace,
		otherWorkspace,
		`${RUN}_impact_ws`,
		`${RUN}_impact_member_ws`,
	])
		for (const table of ["run_index", "analysis_finding_runs"])
			await clickhouse.execute({
				query: `DELETE FROM rudel.${table} WHERE organization_id = {organization:String} SETTINGS lightweight_deletes_sync = 2`,
				query_params: { organization },
			});
});

describe("the runs view", () => {
	const several = `${RUN}_several`;
	beforeAll(async () => {
		await seed([
			// Generation 1, built and committed, then superseded by generation 2.
			{
				organization: workspace,
				user: memberId,
				session: several,
				revision: "1",
				build: "1",
				runs: [
					[1, 10],
					[2, 20],
				],
				receipt: true,
			},
			// Generation 2: the committed build.
			{
				organization: workspace,
				user: memberId,
				session: several,
				revision: "2",
				build: "5",
				runs: [
					[1, 11],
					[2, 21],
					[3, 5],
				],
				receipt: true,
			},
			// A newer build that crashed before its receipt: never read.
			{
				organization: workspace,
				user: memberId,
				session: several,
				revision: "2",
				build: "6",
				runs: [[1, 999]],
				receipt: false,
			},
			// Older than 30 days.
			{
				organization: workspace,
				user: memberId,
				session: `${RUN}_old`,
				revision: "1",
				build: "1",
				runs: [[1, 70]],
				receipt: true,
				daysAgo: 40,
			},
			// A colleague's session in the same workspace.
			{
				organization: workspace,
				user: colleagueId,
				session: `${RUN}_colleague_session`,
				revision: "1",
				build: "1",
				runs: [[1, 50]],
				receipt: true,
			},
			// The member's session in another workspace.
			{
				organization: otherWorkspace,
				user: memberId,
				session: `${RUN}_elsewhere`,
				revision: "1",
				build: "1",
				runs: [[1, 100]],
				receipt: true,
			},
		]);
	});

	test("ranking runs by active minutes for 30 days counts each run of a session with several builds once", async () => {
		const ranked = ok(
			await runSql(member, { query: RANKING, title: "Longest runs" }, env()),
		);
		expect(ranked.table).toBe(
			[
				"session_id | turn_idx | active_minutes",
				`${several} | 2 | 21`,
				`${several} | 1 | 11`,
				`${several} | 3 | 5`,
			].join("\n"),
		);
		const totals = ok(
			await runSql(
				member,
				{
					query:
						"SELECT count() AS runs, sum(active_minutes) AS active FROM runs WHERE started_at >= now() - INTERVAL 30 DAY",
					title: "Totals",
				},
				env(),
			),
		);
		expect(totals.table).toBe("runs | active\n3 | 37");
	});

	test("by default every member reads every member's sessions of the workspace; with own sessions only, a member reads theirs and an admin everyone's", async () => {
		const team = [
			`${RUN}_colleague_session | 1 | 50`,
			`${several} | 2 | 21`,
			`${several} | 1 | 11`,
			`${several} | 3 | 5`,
		];
		for (const caller of [teammate, admin]) {
			const ranked = ok(
				await runSql(caller, { query: RANKING, title: "Team" }, env()),
			);
			expect(ranked.table.split("\n").slice(1)).toEqual(team);
		}
		const own = ok(
			await runSql(member, { query: RANKING, title: "Mine" }, env()),
		);
		expect(own.table.split("\n").slice(1)).toEqual(team.slice(1));
	});

	test("ClickHouse's own refusal of a bad column is recoverable and names the column without the server's statement", async () => {
		const outcome = await runSql(
			member,
			{ query: "SELECT minutez FROM runs", title: "Typo" },
			env(),
		);
		expect(outcome).toMatchObject({
			ok: false,
			error: { kind: "recoverable", fragment: "minutez" },
		});
		const text = JSON.stringify(outcome);
		expect(text).not.toContain("run_index");
		expect(text).not.toContain("opaline_workspace");
	});

	test("schema lists a column's values from the caller's runs", async () => {
		expect(
			await describeSchema(member, { view: "runs", column: "turn_idx" }, env()),
		).toMatchObject({
			ok: true,
			result: {
				values: [
					{ value: "1", rows: 1 },
					{ value: "2", rows: 1 },
					{ value: "3", rows: 1 },
				],
			},
		});
	});
});

describe("stored results and the quota in Postgres", () => {
	const ownerOf = `${RUN}_pg_owner`;
	const author = `${RUN}_pg_author`;
	const bystander = `${RUN}_pg_bystander`;
	const organization = `${RUN}_pg_ws`;
	const store = createPostgresSqlResultStore(sqlClient);
	const output = {
		title: "t",
		query: "SELECT 1 FROM runs",
		columns: [],
		rows: 0,
		truncated: false,
		table: "(no rows)",
		notices: [],
		sessions: [],
		runs: [],
	};
	const ids = async () =>
		(
			await sqlClient<{ id: string }[]>`
				SELECT id FROM analysis_sql_result WHERE organization_id = ${organization} ORDER BY id
			`
		).map((row) => row.id);

	test("deleting an account deletes its results and every result whose rows quoted the sessions it read, removes every other result that only counted them, with any SQL that carries text, and deleting the workspace deletes the rest", async () => {
		for (const id of [ownerOf, author, bystander])
			await sqlClient`INSERT INTO "user" (id, name, email) VALUES (${id}, ${id}, ${`${id}@example.com`})`;
		await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${organization}, ${organization}, ${organization})`;
		for (const [userId, role] of [
			[author, "owner"],
			[ownerOf, "member"],
			[bystander, "member"],
		] as const)
			await sqlClient`
				INSERT INTO member (id, organization_id, user_id, role)
				VALUES (${`${RUN}_${userId}_m`}, ${organization}, ${userId}, ${role})
			`;
		const literal = "SELECT count() FROM runs WHERE prompt_head = 'a prompt'";
		const save = (
			authorId: string,
			owners: string[],
			counts = true,
			query = output.query,
		) =>
			store.save({
				workspaceId: organization,
				authorId,
				title: "t",
				query,
				output,
				owners,
				counts,
				queryCarriesText: query === literal,
			});
		const own = await save(ownerOf, [ownerOf]);
		const readTheirs = await save(author, [author, bystander, ownerOf]);
		const quotedTheirs = await save(author, [author, ownerOf], false);
		const literalTheirs = await save(author, [author, ownerOf], true, literal);
		const others = await save(author, [author, bystander]);
		expect(await ids()).toEqual(
			[own, readTheirs, quotedTheirs, literalTheirs, others].sort(),
		);

		await deleteUserPostgresData(ownerOf, { sqlClient });
		await purgeUntilDone({ targetType: "account", targetId: ownerOf });
		expect(await ids()).toEqual([readTheirs, literalTheirs, others].sort());
		expect(await store.get(own)).toBeNull();
		expect(await store.get(quotedTheirs)).toBeNull();
		expect(await store.get(readTheirs)).toMatchObject({
			title: "t",
			query: output.query,
			output: null,
			removed: true,
			owners: [author, bystander],
		});
		expect(await store.get(literalTheirs)).toMatchObject({
			title: "t",
			query: "",
			output: null,
			removed: true,
			owners: [author],
		});
		expect(await store.get(others)).toMatchObject({ output, removed: false });

		// Workspace deletion as deleteOrganizationPostgresData does it: the
		// purge is queued in the transaction that deletes the workspace.
		await sqlClient.begin(async (transaction) => {
			await enqueueClickHousePurge(
				{ targetId: organization, targetType: "organization" },
				transaction,
			);
			await transaction.unsafe("DELETE FROM organization WHERE id = $1", [
				organization,
			]);
		});
		await purgeUntilDone({
			targetType: "organization",
			targetId: organization,
		});
		expect(await ids()).toEqual([]);
	});

	test("results older than 90 days expire; newer ones stay", async () => {
		const retentionWorkspace = `${RUN}_retention_ws`;
		const retentionAuthor = `${RUN}_retention_author`;
		await sqlClient`INSERT INTO "user" (id, name, email) VALUES (${retentionAuthor}, ${retentionAuthor}, ${`${retentionAuthor}@example.com`})`;
		await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${retentionWorkspace}, ${retentionWorkspace}, ${retentionWorkspace})`;
		const save = () =>
			store.save({
				workspaceId: retentionWorkspace,
				authorId: retentionAuthor,
				title: "t",
				query: output.query,
				output,
				owners: [retentionAuthor],
				counts: true,
				queryCarriesText: false,
			});
		const old = await save();
		const recent = await save();
		await sqlClient`UPDATE analysis_sql_result SET created_at = now() - interval '91 days' WHERE id = ${old}`;
		await expireSqlResults(sqlClient);
		const left = await sqlClient<{ id: string }[]>`
			SELECT id FROM analysis_sql_result WHERE organization_id = ${retentionWorkspace}
		`;
		expect(left.map((row) => row.id)).toEqual([recent]);
		await sqlClient`DELETE FROM organization WHERE id = ${retentionWorkspace}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${retentionAuthor}`;
	});

	test("the workspace quota allows its queries per window, then refuses until the window ends", async () => {
		const quotaWorkspace = `${RUN}_quota_ws`;
		await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${quotaWorkspace}, ${quotaWorkspace}, ${quotaWorkspace})`;
		const quota = createPostgresSqlQuota(sqlClient, {
			queries: 2,
			windowMs: 3_600_000,
		});
		expect(await quota.take(quotaWorkspace)).toEqual({ allowed: true });
		expect(await quota.take(quotaWorkspace)).toEqual({ allowed: true });
		const refused = await quota.take(quotaWorkspace);
		expect(refused.allowed).toBe(false);
		await sqlClient`DELETE FROM organization WHERE id = ${quotaWorkspace}`;
	});
});

describe("visibility sync requests in Postgres", () => {
	test("a newer request outlives the clearing of an older one, a deferred one waits, and a due one is listed with its workspace", async () => {
		const organization = `${RUN}_sync_ws`;
		await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${organization}, ${organization}, ${organization})`;
		const syncs = createPostgresVisibilitySyncs(sqlClient);
		const target = { workspaceId: organization, analysisId: `${RUN}_sync_a` };
		const mine = <TRow extends { analysisId: string }>(rows: TRow[]) =>
			rows.filter((row) => row.analysisId === target.analysisId);

		const first = await syncs.request(target);
		const second = await syncs.request(target);
		expect(second).toBe(first + 1);
		await syncs.clear(target.analysisId, first);
		expect(mine(await syncs.due(1_000))).toEqual([
			{ ...target, ticket: second },
		]);

		await syncs.defer(target.analysisId, second);
		expect(mine(await syncs.due(1_000))).toEqual([]);
		await syncs.clear(target.analysisId, second);
		const [left] = await sqlClient<{ count: string }[]>`
			SELECT count(*) AS count FROM analysis_visibility_sync WHERE analysis_id = ${target.analysisId}
		`;
		expect(Number(left?.count)).toBe(0);

		// Deleting the workspace deletes its requests.
		await syncs.request(target);
		await sqlClient`DELETE FROM organization WHERE id = ${organization}`;
		expect(mine(await syncs.due(1_000))).toEqual([]);
	});
});

describe("finding impact", () => {
	const organization = `${RUN}_impact_ws`;
	const authorId = `${RUN}_impact_author`;
	const quotedId = `${RUN}_impact_quoted`;
	const countedId = `${RUN}_impact_counted`;
	const readerId = `${RUN}_impact_reader`;
	const quotedSession = `${RUN}_impact_quoted_session`;
	const countedSession = `${RUN}_impact_counted_session`;
	const caller = (userId: string): SqlCaller => ({
		workspaceId: organization,
		reader: { userId, role: "member", ownSessionsOnly: false },
	});
	const viewer: AnalysisViewer = {
		workspaceId: organization,
		userId: authorId,
		isAdmin: false,
		restrictResults: false,
		onlyMember: null,
	};
	const IMPACT = `SELECT step_id, count() AS runs, sum(cost_usd) AS cost,
		sum(output_tokens) AS output, sum(active_minutes) AS active
		FROM finding_runs GROUP BY step_id ORDER BY runs, step_id`;
	const ref = (sessionId: string, turn: number) => ({
		sessionId,
		agentId: "",
		turn,
	});

	test("after saving, SQL sums the recorded cost, tokens and active time of each finding's runs; others read them once shared; deleting a quoted member removes the analysis's rows", async () => {
		await seed([
			{
				organization,
				user: quotedId,
				session: quotedSession,
				revision: "1",
				build: "1",
				runs: [
					[1, 4, 0.5, 100],
					[2, 6, 1.25, 300],
				],
				receipt: true,
			},
			{
				organization,
				user: countedId,
				session: countedSession,
				revision: "1",
				build: "1",
				// The second run's usage is unknown: NULL, never zero.
				runs: [
					[1, 10, 2, 1_000],
					[2, 3],
				],
				receipt: true,
			},
		]);
		const log = {
			store: createMemoryAnalysisStore(),
			embedder: createLocalEmbedder(),
			now: () => new Date(),
		};
		const writer = createClickHouseFindingImpact(
			clickhouse,
			createPostgresFindingImpactFence(sqlClient),
		);
		// The share's write is best effort; a failure here must not hide.
		const failures: string[] = [];
		const impact = {
			impact: {
				...writer,
				share: (...args: Parameters<FindingImpact["share"]>): Promise<void> =>
					writer.share(...args).catch((error: unknown) => {
						failures.push(String(error));
						throw error;
					}),
			},
			syncs: createPostgresVisibilitySyncs(sqlClient),
		};
		await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${organization}, ${organization}, ${organization})`;
		const author = {
			workspaceId: organization,
			userId: authorId,
			host: "plugin" as const,
		};
		// A ranking whose rows name the counted member's runs, then a read of
		// the quoted member's runs.
		const ranked = await recordQuery(log, author, {
			tool: "sql",
			args: { query: "SELECT … FROM runs", title: "Costly runs" },
			trace: {},
			output: { runs: [ref(countedSession, 1), ref(countedSession, 2)] },
			outputChars: 100,
			// Numbers and ids only: the counted member's deletion keeps it.
			quotes: false,
			sessions: [],
			owners: [quotedId, countedId],
		});
		const read = await recordQuery(log, author, {
			tool: "read",
			args: { refs: [ref(quotedSession, 1), ref(quotedSession, 2)] },
			trace: { analysis: ranked.analysis },
			output: {
				reads: [
					{ ref: ref(quotedSession, 1), header: "first" },
					{ ref: ref(quotedSession, 2), header: "second" },
				],
			},
			outputChars: 100,
			sessions: [
				{
					sessionId: quotedSession,
					ownerId: quotedId,
					revision: "1",
					parserVersion: 9,
				},
			],
			owners: [quotedId],
		});
		await saveAnalysis(
			log,
			viewer,
			{
				analysis: ranked.analysis,
				question: "Where did cost go?",
				finalAnswer: "Two expensive runs.",
				findings: [
					{ step: ranked.query, finding: "The costliest runs." },
					{ step: read.query, finding: "Both stalled on tests." },
				],
				topics: [],
				changes: [],
			},
			impact,
		);

		const sums = ok(
			await runSql(caller(authorId), { query: IMPACT, title: "Impact" }, env()),
		);
		expect(sums.table.split("\n").slice(1)).toEqual(
			[
				`${read.step} | 2 | 1.75 | 400 | 10`,
				`${ranked.step} | 2 | 2 | 1000 | 13`,
			].sort(),
		);
		// Private to the author until shared.
		expect(
			ok(
				await runSql(
					caller(readerId),
					{ query: IMPACT, title: "Impact" },
					env(),
				),
			).rows,
		).toBe(0);
		await shareAnalysis(log, viewer, ranked.analysis, true, impact);
		expect(failures).toEqual([]);
		expect(
			ok(
				await runSql(
					caller(readerId),
					{ query: IMPACT, title: "Impact" },
					env(),
				),
			).rows,
		).toBe(2);
		const target = { workspaceId: organization, analysisId: ranked.analysis };
		expect(
			await sqlClient`SELECT 1 FROM analysis_visibility_sync WHERE analysis_id = ${ranked.analysis}`,
		).toHaveLength(0);

		// An unshare (revision 2) written before the share it follows
		// (revision 1): the rows stay private.
		await impact.impact.share(target, { shared: false, revision: 2 });
		await impact.impact.share(target, { shared: true, revision: 1 });
		expect(
			ok(
				await runSql(
					caller(readerId),
					{ query: IMPACT, title: "Impact" },
					env(),
				),
			).rows,
		).toBe(0);

		// The analysis quoted this member's runs, so deleting them deletes
		// every row of the analysis, the counted member's runs included.
		await sqlClient`INSERT INTO "user" (id, name, email) VALUES (${quotedId}, ${quotedId}, ${`${quotedId}@example.com`})`;
		await deleteUserPostgresData(quotedId, { sqlClient });
		await purgeUntilDone({ targetType: "account", targetId: quotedId });
		const left = await clickhouse.query<{ rows: string }>({
			query:
				"SELECT count() AS rows FROM rudel.analysis_finding_runs WHERE organization_id = {organization:String}",
			query_params: { organization },
		});
		expect(Number(left[0]?.rows)).toBe(0);
		await sqlClient`DELETE FROM organization WHERE id = ${organization}`;
	});

	test("a saver held to their own sessions records only their own runs", async () => {
		const memberWorkspace = `${RUN}_impact_member_ws`;
		const saver = `${RUN}_impact_saver`;
		const teammate = `${RUN}_impact_teammate`;
		const own = `${RUN}_impact_own_session`;
		const theirs = `${RUN}_impact_their_session`;
		await seed(
			[
				[saver, own],
				[teammate, theirs],
			].map(([user = "", session = ""]) => ({
				organization: memberWorkspace,
				user,
				session,
				revision: "1",
				build: "1",
				runs: [[1, 5, 1, 10]],
				receipt: true,
			})),
		);
		const log = {
			store: createMemoryAnalysisStore(),
			embedder: createLocalEmbedder(),
			now: () => new Date(),
		};
		const trace = await recordQuery(
			log,
			{ workspaceId: memberWorkspace, userId: saver, host: "plugin" },
			{
				tool: "sql",
				args: { query: "SELECT … FROM runs", title: "Runs" },
				trace: {},
				output: { runs: [ref(own, 1), ref(theirs, 1)] },
				outputChars: 10,
				quotes: false,
				sessions: [],
				owners: [saver, teammate],
			},
		);
		await saveAnalysis(
			log,
			{
				workspaceId: memberWorkspace,
				userId: saver,
				isAdmin: false,
				restrictResults: false,
				onlyMember: saver,
			},
			{
				analysis: trace.analysis,
				question: "Which runs?",
				finalAnswer: "Mine.",
				findings: [{ step: trace.query, finding: "Both ran long." }],
				topics: [],
				changes: [],
			},
			{
				impact: createClickHouseFindingImpact(
					clickhouse,
					createPostgresFindingImpactFence(sqlClient),
				),
				syncs: createPostgresVisibilitySyncs(sqlClient),
			},
		);
		const users = await clickhouse.query<{ user_id: string }>({
			query:
				"SELECT user_id FROM rudel.analysis_finding_runs FINAL WHERE organization_id = {organization:String}",
			query_params: { organization: memberWorkspace },
		});
		expect(users.map((row) => row.user_id)).toEqual([saver]);
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
}
