import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { needsObjectStoreSweep } from "../services/object-store-sweep.service.js";
import { withPostgresLease } from "../services/postgres-lease.service.js";
import { readR2IngestAvailability } from "../services/r2-ingest-storage.service.js";

type Environment = Readonly<Record<string, string | undefined>>;
type CronHandler = (request: Request) => Promise<Response>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JOB_LEASE_TTL_MS = 60_000;

const logger = getLogger(["rudel", "api", "selfhost", "scheduler"]);

export interface SchedulerJob {
	readonly name: string;
	readonly everyMs: number;
	readonly firstAfterMs: number;
	readonly handler: () => Promise<CronHandler>;
}

export type JobLock = <T>(
	name: string,
	work: () => Promise<T>,
) => Promise<{ status: "busy" } | { status: "done"; result: T }>;

export interface JobOutcome {
	readonly job: string;
	readonly status: "ok" | "failed" | "busy";
	readonly httpStatus?: number;
	readonly ms: number;
	readonly body?: unknown;
	readonly error?: string;
}

export interface Scheduler {
	readonly jobs: readonly string[];
	runNow(name: string): void;
	stop(): Promise<void>;
}

function hasAll(env: Environment, names: readonly string[]): boolean {
	return names.every((name) => Boolean(env[name]?.trim()));
}

export function selfHostedJobs(env: Environment = process.env): SchedulerJob[] {
	const storage = readR2IngestAvailability({
		...env,
		OPALINE_SELF_HOSTED: "1",
	});
	const objectStore = storage.enabled;
	const objectStoreSweep =
		storage.enabled && needsObjectStoreSweep(storage.configuration);
	const jobs: (SchedulerJob & { readonly when: boolean })[] = [
		{
			name: "l1-edges",
			everyMs: MINUTE,
			firstAfterMs: 5_000,
			when: true,
			handler: async () =>
				(await import("../handlers/l1-edges-maintenance.js"))
					.handleL1EdgesMaintenanceRequest,
		},
		{
			name: "run-index-heal",
			everyMs: 5 * MINUTE,
			firstAfterMs: 30_000,
			when: true,
			handler: async () =>
				(await import("../handlers/run-index-heal-maintenance.js"))
					.handleRunIndexHealMaintenanceRequest,
		},
		{
			name: "session-retirement",
			everyMs: HOUR,
			firstAfterMs: 5 * MINUTE,
			when: true,
			handler: async () =>
				(await import("../handlers/session-retirement-maintenance.js"))
					.handleSessionRetirementMaintenanceRequest,
		},
		{
			name: "repair",
			everyMs: DAY,
			firstAfterMs: 10 * MINUTE,
			when: true,
			handler: async () =>
				(await import("../handlers/api-maintenance.js"))
					.handleApiMaintenanceRequest,
		},
		{
			name: "native-lineage",
			everyMs: DAY,
			firstAfterMs: 15 * MINUTE,
			when: true,
			handler: async () =>
				(await import("../handlers/native-session-lineage-maintenance.js"))
					.handleNativeSessionLineageMaintenanceRequest,
		},
		{
			name: "github-evidence",
			everyMs: 5 * MINUTE,
			firstAfterMs: MINUTE,
			when: hasAll(env, [
				"GITHUB_REPOSITORY_APP_ID",
				"GITHUB_REPOSITORY_APP_PRIVATE_KEY",
			]),
			handler: async () =>
				(await import("../handlers/github-evidence-maintenance.js"))
					.handleGitHubEvidenceMaintenanceRequest,
		},
		{
			name: "history",
			everyMs: MINUTE,
			firstAfterMs: 2 * MINUTE,
			when: hasAll(env, ["OPENAI_API_KEY"]),
			handler: async () =>
				(await import("../handlers/history-maintenance.js"))
					.handleHistoryMaintenanceRequest,
		},
		{
			name: "run-questions",
			everyMs: MINUTE,
			firstAfterMs: 2 * MINUTE,
			when: hasAll(env, ["SUBQ_API_KEY"]) || hasAll(env, ["TYPESAFE_API_KEY"]),
			handler: async () =>
				(await import("../handlers/run-questions-maintenance.js"))
					.handleRunQuestionsMaintenanceRequest,
		},
		{
			name: "live-sessions",
			everyMs: HOUR,
			firstAfterMs: 10 * MINUTE,
			when: objectStore,
			handler: async () =>
				(await import("../handlers/live-sessions-maintenance.js"))
					.handleLiveSessionsMaintenanceRequest,
		},
		{
			name: "r2-ingest",
			everyMs: MINUTE,
			firstAfterMs: 20_000,
			when: objectStore,
			handler: async () =>
				(await import("../handlers/api-maintenance.js"))
					.handleR2IngestMaintenanceRequest,
		},
		{
			name: "object-store-sweep",
			everyMs: HOUR,
			firstAfterMs: 3 * MINUTE,
			when: objectStoreSweep,
			handler: async () =>
				(await import("../handlers/object-store-sweep-maintenance.js"))
					.handleObjectStoreSweepRequest,
		},
	];
	return jobs.filter((job) => job.when).map(({ when: _when, ...job }) => job);
}

export function leaseJobLock(
	sql: postgres.Sql,
	ttlMs = JOB_LEASE_TTL_MS,
): JobLock {
	return async (name, work) => {
		const outcome = await withPostgresLease(`selfhost-job:${name}`, work, {
			database: sql,
			ttlMs,
		});
		return outcome.status === "busy"
			? { status: "busy" }
			: { status: "done", result: outcome.result };
	};
}

export async function runJobOnce(
	job: SchedulerJob,
	lock: JobLock,
	cronSecret: string,
	now: () => number = Date.now,
): Promise<JobOutcome> {
	const startedAt = now();
	try {
		const outcome = await lock(job.name, async () => {
			const handle = await job.handler();
			const response = await handle(
				new Request(`http://selfhost.internal/api/cron/${job.name}`, {
					headers: { Authorization: `Bearer ${cronSecret}` },
				}),
			);
			const body = await response.json().catch(() => null);
			return { httpStatus: response.status, body };
		});
		if (outcome.status === "busy")
			return { job: job.name, status: "busy", ms: now() - startedAt };
		return {
			job: job.name,
			status: outcome.result.httpStatus < 400 ? "ok" : "failed",
			httpStatus: outcome.result.httpStatus,
			ms: now() - startedAt,
			body: outcome.result.body,
		};
	} catch (error) {
		return {
			job: job.name,
			status: "failed",
			ms: now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function startScheduler(options: {
	readonly jobs: readonly SchedulerJob[];
	readonly lock: JobLock;
	readonly cronSecret: string;
	readonly onOutcome?: (outcome: JobOutcome) => void;
}): Scheduler {
	let stopped = false;
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const running = new Map<string, Promise<void>>();
	const rerun = new Set<string>();
	const byName = new Map(options.jobs.map((job) => [job.name, job]));
	const report = options.onOutcome ?? logOutcome;

	const schedule = (job: SchedulerJob, delayMs: number) => {
		if (stopped) return;
		timers.set(
			job.name,
			setTimeout(() => {
				timers.delete(job.name);
				const run = runJobOnce(job, options.lock, options.cronSecret)
					.then(report)
					.finally(() => {
						running.delete(job.name);
						schedule(job, rerun.delete(job.name) ? 0 : job.everyMs);
					});
				running.set(job.name, run);
			}, delayMs),
		);
	};

	for (const job of options.jobs) schedule(job, job.firstAfterMs);

	return {
		jobs: options.jobs.map((job) => job.name),
		runNow(name) {
			const job = byName.get(name);
			if (stopped || !job) return;
			if (running.has(name)) {
				rerun.add(name);
				return;
			}
			clearTimeout(timers.get(name));
			timers.delete(name);
			schedule(job, 0);
		},
		async stop() {
			stopped = true;
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
			await Promise.allSettled([...running.values()]);
		},
	};
}

export async function startPurgeWorker(): Promise<{ stop(): Promise<void> }> {
	const [purge, { readResendConfig }, { readBooleanEnv }] = await Promise.all([
		import("../services/clickhouse-purge.service.js"),
		import("../resend-config.js"),
		import("../lib/env.js"),
	]);
	const worker = purge.startClickHousePurgeWorker({
		enabled: readBooleanEnv("CLICKHOUSE_PURGE_WORKER_ENABLED", true),
		resend: readResendConfig(),
	});
	purge.registerClickHousePurgeWorker(worker);
	return { stop: () => worker.stop() };
}

function logOutcome(outcome: JobOutcome): void {
	if (outcome.status === "failed") {
		logger.error("Job {job} failed after {ms}ms: {detail}", {
			job: outcome.job,
			ms: outcome.ms,
			detail: outcome.error ?? JSON.stringify(outcome.body),
		});
		return;
	}
	logger.info("Job {job} {status} in {ms}ms {body}", {
		job: outcome.job,
		status: outcome.status,
		ms: outcome.ms,
		body: outcome.body === undefined ? "" : JSON.stringify(outcome.body),
	});
}
