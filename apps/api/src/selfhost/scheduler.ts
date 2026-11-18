import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { runAsBackgroundWork } from "../lib/background-work.js";
import { needsObjectStoreSweep } from "../services/object-store-sweep.service.js";
import { withPostgresLease } from "../services/postgres-lease.service.js";
import { readR2IngestAvailability } from "../services/r2-ingest-storage.service.js";

type Environment = Readonly<Record<string, string | undefined>>;
type CronHandler = (request: Request) => Promise<Response>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JOB_LEASE_TTL_MS = 60_000;
const MIN_DUE_DELAY_MS = 1_000;

const logger = getLogger(["rudel", "api", "selfhost", "scheduler"]);

export interface JobRest {
	readonly quiet: (body: unknown) => boolean;
	readonly maxMs: number;
}

export interface SchedulerJob {
	readonly name: string;
	readonly everyMs: number;
	readonly firstAfterMs: number;
	readonly handler: () => Promise<CronHandler>;
	readonly rest?: JobRest;
}

export type PendingWork = (job: string, sinceMs: number) => Promise<boolean>;

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

function numberAt(body: unknown, path: readonly string[]): number {
	let value: unknown = body;
	for (const key of path)
		value =
			typeof value === "object" && value !== null
				? Reflect.get(value, key)
				: undefined;
	return typeof value === "number" ? value : 0;
}

function trueAt(body: unknown, path: readonly string[]): boolean {
	let value: unknown = body;
	for (const key of path)
		value =
			typeof value === "object" && value !== null
				? Reflect.get(value, key)
				: undefined;
	return value === true;
}

const nothingAt =
	(
		counts: readonly (readonly string[])[],
		more: readonly (readonly string[])[],
	) =>
	(body: unknown) =>
		counts.every((path) => numberAt(body, path) === 0) &&
		!more.some((path) => trueAt(body, path));

export const JOB_RESTS = {
	"l1-edges": {
		maxMs: HOUR,
		quiet: nothingAt(
			[
				["l1Edges", "built"],
				["contextSnapshots", "written"],
				["usageRollups", "written"],
			],
			[],
		),
	},
	"run-index-heal": {
		maxMs: HOUR,
		quiet: nothingAt(
			[
				["runIndexHeal", "queued"],
				["runIndexHeal", "remaining"],
				["runIndexHeal", "reparsed"],
				["runIndexHeal", "queue", "pending"],
			],
			[],
		),
	},
	"github-evidence": {
		maxMs: 30 * MINUTE,
		quiet: nothingAt(
			[
				["githubEvidence", "attempted"],
				["githubSweep", "requests"],
			],
			[
				["githubEvidence", "hasMore"],
				["githubSweep", "hasMore"],
			],
		),
	},
	"r2-ingest": {
		maxMs: 10 * MINUTE,
		quiet: nothingAt(
			[
				["attempted"],
				["completed"],
				["repositoryEvidenceIndex", "result", "attempted"],
				["findingVisibility", "result", "attempted"],
			],
			[
				["hasMore"],
				["repositoryEvidenceIndex", "result", "hasMore"],
				["findingVisibility", "result", "hasMore"],
			],
		),
	},
} as const satisfies Record<string, JobRest>;

function restOf(name: string): JobRest | undefined {
	return Reflect.get(JOB_RESTS, name) as JobRest | undefined;
}

const PENDING_CLOCK_MARGIN_MS = 10_000;

export function postgresPendingWork(sql: postgres.Sql): PendingWork {
	return async (_job, sinceMs) => {
		const since = new Date(sinceMs - PENDING_CLOCK_MARGIN_MS).toISOString();
		const [row] = await sql<{ pending: boolean }[]>`
			SELECT EXISTS (
				SELECT 1 FROM l1_edge_scope
				WHERE updated_at > ${since}::timestamptz
					OR (request_count > built_request_count AND next_attempt_at <= now()
						AND (lease_expires_at IS NULL OR lease_expires_at <= now()))
			) AS pending`;
		return row?.pending === true;
	};
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
			everyMs: 5 * MINUTE,
			firstAfterMs: 5 * MINUTE,
			when: true,
			handler: async () =>
				(await import("../handlers/session-retirement-maintenance.js"))
					.handleSessionRetirementMaintenanceRequest,
		},
		{
			name: "deleted-rows",
			everyMs: HOUR,
			firstAfterMs: 20 * MINUTE,
			when: true,
			handler: async () =>
				(await import("../handlers/deleted-rows-maintenance.js"))
					.handleDeletedRowsMaintenanceRequest,
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
			name: "analysis-log-retention",
			everyMs: DAY,
			firstAfterMs: 3 * MINUTE,
			when: true,
			handler: async () =>
				(await import("../handlers/analysis-log-retention-maintenance.js"))
					.handleAnalysisLogRetentionMaintenanceRequest,
		},
		{
			name: "github-evidence",
			everyMs: 5 * MINUTE,
			firstAfterMs: MINUTE,
			when: true,
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
	return jobs
		.filter((job) => job.when)
		.map(({ when: _when, ...job }) => {
			const rest = restOf(job.name);
			return rest ? { ...job, rest } : job;
		});
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
			const response = await runAsBackgroundWork(() =>
				handle(
					new Request(`http://selfhost.internal/api/cron/${job.name}`, {
						headers: { Authorization: `Bearer ${cronSecret}` },
					}),
				),
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

export function delayUntilDue(
	outcome: JobOutcome,
	everyMs: number,
	nowMs: number,
): number {
	const body = outcome.body;
	if (outcome.status !== "ok" || typeof body !== "object" || body === null)
		return everyMs;
	const dueAt = Date.parse(String(Reflect.get(body, "nextDueAt") ?? ""));
	if (Number.isNaN(dueAt)) return everyMs;
	return Math.min(everyMs, Math.max(MIN_DUE_DELAY_MS, dueAt - nowMs));
}

export function startScheduler(options: {
	readonly jobs: readonly SchedulerJob[];
	readonly lock: JobLock;
	readonly cronSecret: string;
	readonly onOutcome?: (outcome: JobOutcome) => void;
	readonly now?: () => number;
	readonly pending?: PendingWork;
}): Scheduler {
	const now = options.now ?? Date.now;
	let stopped = false;
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const running = new Map<string, Promise<void>>();
	const rerun = new Set<string>();
	const forced = new Set<string>();
	const resting = new Set<string>();
	const lastRunAt = new Map<string, number>();
	const byName = new Map(options.jobs.map((job) => [job.name, job]));
	const report = options.onOutcome ?? logOutcome;

	const shouldRest = async (job: SchedulerJob): Promise<boolean> => {
		const pending = options.pending;
		if (forced.delete(job.name) || !job.rest || !pending) return false;
		if (!resting.has(job.name)) return false;
		const since = lastRunAt.get(job.name) ?? 0;
		if (now() - since >= job.rest.maxMs) return false;
		return !(await pending(job.name, since).catch((error: unknown) => {
			logger.warn("Checking for work of job {job} failed: {error}", {
				job: job.name,
				error: error instanceof Error ? error.message : String(error),
			});
			return true;
		}));
	};

	const runOrRest = async (job: SchedulerJob): Promise<number> => {
		if (await shouldRest(job)) return job.everyMs;
		lastRunAt.set(job.name, now());
		const outcome = await runJobOnce(
			job,
			options.lock,
			options.cronSecret,
			now,
		);
		if (outcome.status === "ok" && job.rest?.quiet(outcome.body))
			resting.add(job.name);
		else if (outcome.status !== "busy") resting.delete(job.name);
		report(outcome);
		return delayUntilDue(outcome, job.everyMs, now());
	};

	const schedule = (job: SchedulerJob, delayMs: number) => {
		if (stopped) return;
		timers.set(
			job.name,
			setTimeout(() => {
				timers.delete(job.name);
				let nextDelayMs = job.everyMs;
				const run = runOrRest(job)
					.then((delay) => {
						nextDelayMs = delay;
					})
					.finally(() => {
						running.delete(job.name);
						schedule(job, rerun.delete(job.name) ? 0 : nextDelayMs);
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
			forced.add(name);
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
