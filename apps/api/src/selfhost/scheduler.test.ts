import { expect, test } from "bun:test";
import type postgres from "postgres";
import {
	delayUntilDue,
	JOB_RESTS,
	type JobLock,
	type JobOutcome,
	leaseJobLock,
	postgresPendingWork,
	runJobOnce,
	type SchedulerJob,
	selfHostedJobs,
	startScheduler,
} from "./scheduler.js";

const unlocked: JobLock = async (_name, work) => ({
	status: "done",
	result: await work(),
});

const job = (
	name: string,
	handle: (request: Request) => Promise<Response>,
	everyMs = 1,
): SchedulerJob => ({
	name,
	everyMs,
	firstAfterMs: 0,
	handler: async () => handle,
});

test("without providers only the jobs that need none run, and billing, trends and digests never do", () => {
	expect(selfHostedJobs({}).map((job) => job.name)).toEqual([
		"l1-edges",
		"run-index-heal",
		"session-retirement",
		"repair",
		"native-lineage",
		"analysis-log-retention",
		"github-evidence",
	]);
	const all = selfHostedJobs({
		OPENAI_API_KEY: "sk",
		SUBQ_API_KEY: "subq",
		R2_ACCOUNT_ID: "a",
		R2_ACCESS_KEY_ID: "b",
		R2_SECRET_ACCESS_KEY: "c",
	});
	expect(all.map((job) => job.name)).toEqual([
		"l1-edges",
		"run-index-heal",
		"session-retirement",
		"repair",
		"native-lineage",
		"analysis-log-retention",
		"github-evidence",
		"history",
		"run-questions",
		"live-sessions",
		"r2-ingest",
	]);
	const every = Object.fromEntries(all.map((job) => [job.name, job.everyMs]));
	expect(every).toMatchObject({
		"l1-edges": 60_000,
		"run-index-heal": 300_000,
		"session-retirement": 3_600_000,
		repair: 86_400_000,
		"native-lineage": 86_400_000,
		"analysis-log-retention": 86_400_000,
	});
	expect(
		Object.fromEntries(all.map((job) => [job.name, job.firstAfterMs])),
	).toMatchObject({ "github-evidence": 60_000 });
	expect(
		selfHostedJobs({ TYPESAFE_API_KEY: "jev" }).map((job) => job.name),
	).toContain("run-questions");
});

test("a local or S3 object store turns on live sessions, ingest repair and the expiry sweep; R2 keeps its lifecycle rule", () => {
	const storageJobs = (env: Record<string, string>) =>
		selfHostedJobs(env)
			.map((job) => job.name)
			.filter((name) =>
				["live-sessions", "r2-ingest", "object-store-sweep"].includes(name),
			);
	const local = {
		APP_URL: "http://localhost:4100",
		BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
		OPALINE_DATA_DIR: "/tmp/opaline-data",
	};
	expect(storageJobs(local)).toEqual([
		"live-sessions",
		"r2-ingest",
		"object-store-sweep",
	]);
	expect(
		storageJobs({
			...local,
			S3_ACCESS_KEY_ID: "k",
			S3_BUCKET: "b",
			S3_ENDPOINT: "http://127.0.0.1:8333",
			S3_SECRET_ACCESS_KEY: "s",
		}),
	).toEqual(["live-sessions", "r2-ingest", "object-store-sweep"]);
	expect(
		storageJobs({
			...local,
			R2_ACCOUNT_ID: "a",
			R2_ACCESS_KEY_ID: "b",
			R2_SECRET_ACCESS_KEY: "c",
		}),
	).toEqual(["live-sessions", "r2-ingest"]);
	expect(storageJobs({ ...local, S3_BUCKET: "only-a-bucket" })).toEqual([]);
	const sweep = selfHostedJobs(local).find(
		(job) => job.name === "object-store-sweep",
	);
	expect(sweep).toMatchObject({ everyMs: 3_600_000, firstAfterMs: 180_000 });
});

test("runNow starts a waiting job at once and reruns a running one right after it finishes", async () => {
	let runs = 0;
	let release: () => void = () => {};
	const outcomes: JobOutcome[] = [];
	const scheduler = startScheduler({
		jobs: [
			{
				name: "r2-ingest",
				everyMs: 60_000,
				firstAfterMs: 60_000,
				handler: async () => async () => {
					runs++;
					if (runs === 1)
						await new Promise<void>((resolve) => {
							release = resolve;
						});
					return Response.json({ ok: true });
				},
			},
		],
		lock: unlocked,
		cronSecret: "0123456789abcdef",
		onOutcome: (outcome) => outcomes.push(outcome),
	});
	scheduler.runNow("unknown-job");
	scheduler.runNow("r2-ingest");
	await Bun.sleep(20);
	expect(runs).toBe(1);
	scheduler.runNow("r2-ingest");
	scheduler.runNow("r2-ingest");
	release();
	await Bun.sleep(30);
	expect(runs).toBe(2);
	await scheduler.stop();
	scheduler.runNow("r2-ingest");
	await Bun.sleep(20);
	expect(runs).toBe(2);
	expect(outcomes.map((outcome) => outcome.status)).toEqual(["ok", "ok"]);
});

test("a job that reports earlier due work runs again then, never sooner than a second or later than its period", () => {
	const ok = (body: unknown): JobOutcome => ({
		job: "r2-ingest",
		status: "ok",
		ms: 1,
		body,
	});
	const now = Date.parse("2026-11-08T21:46:36.315Z");
	expect(
		delayUntilDue(ok({ nextDueAt: "2026-11-08T21:46:41.309Z" }), 60_000, now),
	).toBe(4_994);
	expect(
		delayUntilDue(ok({ nextDueAt: "2026-11-08T21:46:36.000Z" }), 60_000, now),
	).toBe(1_000);
	expect(
		delayUntilDue(ok({ nextDueAt: "2026-11-08T23:00:00.000Z" }), 60_000, now),
	).toBe(60_000);
	expect(delayUntilDue(ok({ nextDueAt: null }), 60_000, now)).toBe(60_000);
	expect(delayUntilDue(ok(null), 60_000, now)).toBe(60_000);
	expect(
		delayUntilDue(
			{ ...ok({ nextDueAt: "2026-11-08T21:46:41.309Z" }), status: "failed" },
			60_000,
			now,
		),
	).toBe(60_000);
});

test("a run calls the cron handler with the cron secret and reports its status", async () => {
	const seen: string[] = [];
	const ok = await runJobOnce(
		job("l1-edges", async (request) => {
			seen.push(request.headers.get("Authorization") ?? "");
			return Response.json({ ok: true, built: 3 });
		}),
		unlocked,
		"0123456789abcdef",
	);
	expect(seen).toEqual(["Bearer 0123456789abcdef"]);
	expect(ok).toMatchObject({
		job: "l1-edges",
		status: "ok",
		httpStatus: 200,
		body: { ok: true, built: 3 },
	});
	const failed = await runJobOnce(
		job("repair", async () => Response.json({ ok: false }, { status: 500 })),
		unlocked,
		"0123456789abcdef",
	);
	expect(failed).toMatchObject({ status: "failed", httpStatus: 500 });
	const thrown = await runJobOnce(
		job("repair", async () => {
			throw new Error("ClickHouse is down");
		}),
		unlocked,
		"0123456789abcdef",
	);
	expect(thrown).toMatchObject({
		status: "failed",
		error: "ClickHouse is down",
	});
	let called = false;
	const busy = await runJobOnce(
		job("repair", async () => {
			called = true;
			return Response.json({});
		}),
		async () => ({ status: "busy" }),
		"0123456789abcdef",
	);
	expect(busy.status).toBe("busy");
	expect(called).toBe(false);
});

test("a job never overlaps itself and stop waits for the run in flight", async () => {
	let active = 0;
	let maxActive = 0;
	let runs = 0;
	const outcomes: JobOutcome[] = [];
	const scheduler = startScheduler({
		jobs: [
			job("l1-edges", async () => {
				active++;
				runs++;
				maxActive = Math.max(maxActive, active);
				await Bun.sleep(15);
				active--;
				return Response.json({ ok: true });
			}),
		],
		lock: unlocked,
		cronSecret: "0123456789abcdef",
		onOutcome: (outcome) => outcomes.push(outcome),
	});
	expect(scheduler.jobs).toEqual(["l1-edges"]);
	await Bun.sleep(80);
	await scheduler.stop();
	const settled = runs;
	expect(active).toBe(0);
	expect(maxActive).toBe(1);
	expect(runs).toBeGreaterThanOrEqual(2);
	expect(outcomes.length).toBe(runs);
	await Bun.sleep(30);
	expect(runs).toBe(settled);
});

test("the lease skips a job another process holds and releases it after the run", async () => {
	const statements: { sql: string; values: unknown[] }[] = [];
	const fakeSql = (acquired: boolean) =>
		({
			unsafe: async (sql: string, values: unknown[]) => {
				statements.push({ sql, values });
				if (sql.includes("INSERT INTO coordination_lease"))
					return acquired ? [{ holder: values[1] }] : [];
				if (sql.includes("DELETE FROM coordination_lease"))
					return [{ holder: values[1] }];
				return [];
			},
		}) as unknown as postgres.Sql;

	let worked = 0;
	expect(
		await leaseJobLock(fakeSql(false))("repair", async () => ++worked),
	).toEqual({ status: "busy" });
	expect(worked).toBe(0);
	expect(statements).toHaveLength(1);
	expect(statements[0]?.values).toEqual([
		"selfhost-job:repair",
		expect.any(String),
		60_000,
	]);

	statements.length = 0;
	expect(
		await leaseJobLock(fakeSql(true))("repair", async () => ++worked),
	).toEqual({ status: "done", result: 1 });
	expect(
		statements.map((statement) => statement.sql.trim().split(" ")[0]),
	).toEqual(["INSERT", "DELETE"]);

	statements.length = 0;
	await expect(
		leaseJobLock(fakeSql(true))("repair", async () => {
			throw new Error("boom");
		}),
	).rejects.toThrow("boom");
	expect(statements.at(-1)?.sql).toContain("DELETE FROM coordination_lease");
});

test("a quiet job rests until Postgres has work for it, runNow wakes it, or its longest rest is over", async () => {
	let runs = 0;
	let pending = false;
	const asked: number[] = [];
	const started = Date.now();
	const scheduler = startScheduler({
		jobs: [
			{
				name: "l1-edges",
				everyMs: 5,
				firstAfterMs: 0,
				rest: {
					maxMs: 300,
					quiet: (body) => Reflect.get(Object(body), "built") === 0,
				},
				handler: async () => async () => {
					runs++;
					return Response.json({ built: 0 });
				},
			},
		],
		lock: unlocked,
		cronSecret: "0123456789abcdef",
		onOutcome: () => {},
		pending: async (_job, since) => {
			asked.push(since);
			return pending;
		},
	});
	await Bun.sleep(80);
	expect(runs).toBe(1);
	expect(asked.length).toBeGreaterThan(3);
	expect(asked[0]).toBeGreaterThanOrEqual(started);
	pending = true;
	await Bun.sleep(30);
	pending = false;
	const afterPending = runs;
	expect(afterPending).toBeGreaterThan(1);
	await Bun.sleep(60);
	expect(runs).toBe(afterPending);
	scheduler.runNow("l1-edges");
	await Bun.sleep(20);
	expect(runs).toBe(afterPending + 1);
	await Bun.sleep(450);
	expect(runs).toBe(afterPending + 2);
	await scheduler.stop();
});

test("a job that found work, failed, or whose Postgres check fails keeps its period", async () => {
	const runs = { busy: 0, failing: 0, unsure: 0 };
	const scheduler = startScheduler({
		jobs: [
			{
				name: "busy",
				everyMs: 5,
				firstAfterMs: 0,
				rest: JOB_RESTS["l1-edges"],
				handler: async () => async () => {
					runs.busy++;
					return Response.json({ l1Edges: { enabled: true, built: 2 } });
				},
			},
			{
				name: "failing",
				everyMs: 5,
				firstAfterMs: 0,
				rest: JOB_RESTS["l1-edges"],
				handler: async () => async () => {
					runs.failing++;
					return Response.json({ error: "no" }, { status: 500 });
				},
			},
			{
				name: "unsure",
				everyMs: 5,
				firstAfterMs: 0,
				rest: JOB_RESTS["l1-edges"],
				handler: async () => async () => {
					runs.unsure++;
					return Response.json({ l1Edges: { enabled: true, built: 0 } });
				},
			},
		],
		lock: unlocked,
		cronSecret: "0123456789abcdef",
		onOutcome: () => {},
		pending: async (job) => {
			if (job === "unsure") throw new Error("Postgres is down");
			return false;
		},
	});
	await Bun.sleep(80);
	await scheduler.stop();
	expect(runs.busy).toBeGreaterThan(3);
	expect(runs.failing).toBeGreaterThan(3);
	expect(runs.unsure).toBeGreaterThan(3);
});

test("the jobs that poll rest when their last run found nothing, the rare ones never do", () => {
	const jobs = Object.fromEntries(
		selfHostedJobs({
			APP_URL: "http://localhost:4100",
			BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
			OPALINE_DATA_DIR: "/tmp/opaline-data",
		}).map((job) => [job.name, job.rest?.maxMs ?? null]),
	);
	expect(jobs).toEqual({
		"l1-edges": 3_600_000,
		"run-index-heal": 3_600_000,
		"session-retirement": null,
		repair: null,
		"native-lineage": null,
		"analysis-log-retention": null,
		"github-evidence": 1_800_000,
		"live-sessions": null,
		"r2-ingest": 600_000,
		"object-store-sweep": null,
	});
	const quiet = (name: keyof typeof JOB_RESTS, body: unknown) =>
		JOB_RESTS[name].quiet(body);
	expect(
		quiet("l1-edges", {
			l1Edges: { enabled: true, built: 0 },
			contextSnapshots: { candidates: 2, written: 0 },
			ok: true,
			usageRollups: { enabled: false },
		}),
	).toBe(true);
	expect(
		quiet("l1-edges", {
			l1Edges: { enabled: true, built: 0 },
			contextSnapshots: { candidates: 4, written: 1 },
		}),
	).toBe(false);
	expect(
		quiet("l1-edges", {
			l1Edges: { enabled: true, built: 0 },
			contextSnapshots: { candidates: 0, written: 0 },
			usageRollups: { enabled: true, candidates: 3, written: 3 },
		}),
	).toBe(false);
	expect(quiet("l1-edges", { ok: true, skipped: "idle" })).toBe(true);
	expect(
		quiet("run-index-heal", {
			ok: true,
			runIndexHeal: {
				status: "ran",
				queue: { pending: 0, recentFailures: 0 },
				remaining: 0,
				queued: 0,
				reparsed: 0,
				retiredGenerations: 0,
			},
		}),
	).toBe(true);
	expect(
		quiet("run-index-heal", {
			runIndexHeal: { queue: { pending: 3 }, queued: 0 },
		}),
	).toBe(false);
	expect(
		quiet("github-evidence", {
			githubEvidence: { enabled: true, attempted: 0, hasMore: false },
			githubSweep: { enabled: true, requests: 0, hasMore: false },
			ok: true,
		}),
	).toBe(true);
	expect(
		quiet("github-evidence", {
			githubEvidence: { attempted: 0, hasMore: false },
			githubSweep: { requests: 12, hasMore: false },
		}),
	).toBe(false);
	expect(
		quiet("github-evidence", {
			githubEvidence: { attempted: 0, hasMore: false },
			githubSweep: { requests: 0, hasMore: true },
		}),
	).toBe(false);
	expect(
		quiet("r2-ingest", {
			attempted: 0,
			completed: 0,
			hasMore: false,
			repositoryEvidenceIndex: {
				result: { attempted: 0, published: 0, hasMore: false },
				status: "ok",
			},
			findingVisibility: {
				result: { attempted: 0, synced: 0, hasMore: false },
				status: "ok",
			},
		}),
	).toBe(true);
	expect(
		quiet("r2-ingest", {
			attempted: 0,
			repositoryEvidenceIndex: { result: { attempted: 1 } },
		}),
	).toBe(false);
});

test("pending work is a changed or due run index scope, read with a margin for clock skew", async () => {
	const seen: unknown[][] = [];
	const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
		seen.push([strings.join("?"), ...values]);
		return [{ pending: true }];
	}) as unknown as postgres.Sql;
	const since = Date.parse("2026-11-09T22:00:00.000Z");
	expect(await postgresPendingWork(sql)("l1-edges", since)).toBe(true);
	expect(String(seen[0]?.[0])).toContain("FROM l1_edge_scope");
	expect(String(seen[0]?.[0])).toContain("updated_at > ?");
	expect(String(seen[0]?.[0])).toContain("next_attempt_at <= now()");
	expect(seen[0]?.[1]).toEqual(new Date("2026-11-09T21:59:50.000Z"));
});
