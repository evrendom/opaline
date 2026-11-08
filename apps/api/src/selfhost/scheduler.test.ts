import { expect, test } from "bun:test";
import type postgres from "postgres";
import {
	advisoryJobLock,
	type JobLock,
	type JobOutcome,
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

test("the advisory lock skips a job another process holds and always unlocks and releases", async () => {
	const statements: string[] = [];
	let released = 0;
	const fakeSql = (locked: boolean) =>
		({
			reserve: async () =>
				Object.assign(
					(strings: TemplateStringsArray, ...values: unknown[]) => {
						statements.push(`${strings.join("?")} ${values.join(",")}`);
						const result = strings.join("").includes("pg_try_advisory_lock")
							? [{ locked }]
							: [];
						return Object.assign(Promise.resolve(result), {
							catch: () => Promise.resolve(result),
						});
					},
					{ release: () => released++ },
				),
		}) as unknown as postgres.Sql;

	let worked = 0;
	expect(
		await advisoryJobLock(fakeSql(false))("repair", async () => ++worked),
	).toEqual({ status: "busy" });
	expect(worked).toBe(0);
	expect(released).toBe(1);
	expect(statements).toHaveLength(1);

	statements.length = 0;
	expect(
		await advisoryJobLock(fakeSql(true))("repair", async () => ++worked),
	).toEqual({ status: "done", result: 1 });
	expect(statements[0]).toContain("pg_try_advisory_lock");
	expect(statements[0]).toContain("731900,repair");
	expect(statements[1]).toContain("pg_advisory_unlock");
	expect(released).toBe(2);

	await expect(
		advisoryJobLock(fakeSql(true))("repair", async () => {
			throw new Error("boom");
		}),
	).rejects.toThrow("boom");
	expect(statements.at(-1)).toContain("pg_advisory_unlock");
	expect(released).toBe(3);
});
