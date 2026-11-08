import { expect, test } from "bun:test";
import type postgres from "postgres";
import {
	delayUntilDue,
	type JobLock,
	type JobOutcome,
	leaseJobLock,
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
	]);
	const all = selfHostedJobs({
		GITHUB_REPOSITORY_APP_ID: "1",
		GITHUB_REPOSITORY_APP_PRIVATE_KEY: "key",
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
	});
	expect(
		selfHostedJobs({ GITHUB_REPOSITORY_APP_ID: "1", R2_ACCOUNT_ID: "a" }).map(
			(job) => job.name,
		),
	).not.toContain("github-evidence");
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
