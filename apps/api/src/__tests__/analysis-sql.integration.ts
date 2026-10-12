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
	/** Runs as [turn, active minutes]; a receipt commits the build when set. */
	runs: [number, number][];
	receipt: boolean;
	daysAgo?: number;
}

async function seed(rows: readonly Seed[]) {
	await clickhouse.insert({
		table: "rudel.run_index",
		asyncInsert: false,
		values: rows.flatMap((row) => [
			...row.runs.map(([turn, active]) => ({
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
	for (const organization of [workspace, otherWorkspace])
		await clickhouse.execute({
			query:
				"DELETE FROM rudel.run_index WHERE organization_id = {organization:String} SETTINGS lightweight_deletes_sync = 2",
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
					{ value: "1", runs: 1 },
					{ value: "2", runs: 1 },
					{ value: "3", runs: 1 },
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
	};
	const ids = async () =>
		(
			await sqlClient<{ id: string }[]>`
				SELECT id FROM analysis_sql_result WHERE organization_id = ${organization} ORDER BY id
			`
		).map((row) => row.id);

	test("deleting an account removes its results and every result that read its sessions; deleting the workspace removes the rest", async () => {
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
		const save = (authorId: string, owners: string[]) =>
			store.save({
				workspaceId: organization,
				authorId,
				title: "t",
				query: output.query,
				output,
				owners,
			});
		const own = await save(ownerOf, [ownerOf]);
		const readTheirs = await save(author, [author, bystander, ownerOf]);
		const others = await save(author, [author, bystander]);
		expect(await ids()).toEqual([own, readTheirs, others].sort());

		await deleteUserPostgresData(ownerOf, { sqlClient });
		await purgeUntilDone({ targetType: "account", targetId: ownerOf });
		expect(await ids()).toEqual([others]);

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
