import type { ClickHouseExecutor } from "../clickhouse.js";
import {
	createMaintenanceQueueDeadline,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import {
	buildKeyedDeleteOperations,
	isDeleteSettled,
	submittedStatements,
} from "./clickhouse-batched-delete.js";
import { runRetirementDeletes } from "./generation-retirement.js";
import { retireOlderGitObservations } from "./git-observation-extraction.service.js";
import { runRunIndexRetirementPass } from "./l1-edges/run-index-retirement.service.js";
import { createTranscriptRecordsDeadline } from "./transcript-records-deadline.js";
import {
	MAX_RETIRED_GENERATIONS_PER_PASS,
	TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
	TRANSCRIPT_RECORDS_TABLE,
} from "./transcript-records-ingest.service.js";
import {
	findTranscriptRecordsRetirementSessions,
	type RetirementSessionRow,
} from "./transcript-records-retirement.service.js";
import {
	RETIREMENT_DRAIN_MAX_PAGE_SIZE,
	type Retirement,
	selectPageRetirements,
} from "./transcript-records-retirement-drain.service.js";
import { retireOlderTranscriptChunkHits } from "./transcript-search/session-index.service.js";

const STEP_BUDGET_MS = 120_000;
const TRANSCRIPT_RECORDS_SESSIONS_PER_PASS = 1_000;
const TRANSCRIPT_RECORDS_WINDOWS_PER_PASS = 2;
const TRANSCRIPT_RECORDS_READS_TIMEOUT_MS = 60_000;
const HOUR_MS = 3_600_000;
const TRANSCRIPT_RECORDS_GENERATION_COLUMNS = [
	{ name: "user_id", type: "String" },
	{ name: "session_id", type: "String" },
	{ name: "revision", type: "UInt64" },
	{ name: "parser_version", type: "UInt16" },
] as const;

export type RetirementStepName =
	| "gitObservations"
	| "chunkHits"
	| "runIndex"
	| "transcriptRecords";

export interface RetirementStepResult {
	status: "ok" | "failed";
	retired: number;
	deleteStatements: number;
	hasMore: boolean;
	error?: string;
}

export async function runSessionRetirementPass(options: {
	readonly executor: ClickHouseExecutor;
	readonly deadline: MaintenanceDeadline;
}): Promise<Record<RetirementStepName, RetirementStepResult>> {
	const { executor, deadline } = options;
	const step = async (
		budgetMs: number,
		run: (deadline: MaintenanceDeadline) => Promise<{
			retired: number;
			deleteStatements: number;
			hasMore: boolean;
		}>,
	): Promise<RetirementStepResult> => {
		try {
			return {
				status: "ok",
				...(await run(createMaintenanceQueueDeadline(deadline, budgetMs))),
			};
		} catch (error) {
			return {
				status: "failed",
				retired: 0,
				deleteStatements: 0,
				hasMore: true,
				error: error instanceof Error ? error.message.slice(0, 512) : "failed",
			};
		}
	};
	const steps: [
		RetirementStepName,
		(deadline: MaintenanceDeadline) => Promise<{
			retired: number;
			deleteStatements: number;
			hasMore: boolean;
		}>,
	][] = [
		[
			"gitObservations",
			async (stepDeadline) => {
				const result = await retireOlderGitObservations(executor, {
					deadline: stepDeadline,
				});
				return {
					retired: result.retired,
					deleteStatements: submittedStatements(result.outcomes),
					hasMore: result.hasMore,
				};
			},
		],
		[
			"chunkHits",
			async (stepDeadline) => {
				const result = await retireOlderTranscriptChunkHits(executor, {
					deadline: stepDeadline,
				});
				return {
					retired: result.retired,
					deleteStatements: submittedStatements(result.outcomes),
					hasMore: result.hasMore,
				};
			},
		],
		[
			"runIndex",
			async (stepDeadline) => {
				const result = await runRunIndexRetirementPass({
					executor,
					deadline: stepDeadline,
				});
				return {
					retired: result.generationsRetired,
					deleteStatements: result.deleteStatements,
					hasMore: result.hasMore,
				};
			},
		],
		[
			"transcriptRecords",
			(stepDeadline) =>
				retireTranscriptRecordsGenerations(executor, {
					deadline: stepDeadline,
				}),
		],
	];
	const first = new Date(deadline.now()).getUTCHours() % steps.length;
	const results: Partial<Record<RetirementStepName, RetirementStepResult>> = {};
	for (const [name, run] of [...steps.slice(first), ...steps.slice(0, first)])
		results[name] = await step(STEP_BUDGET_MS, run);
	return results as Record<RetirementStepName, RetirementStepResult>;
}

export interface TranscriptRecordsRetirementResult {
	retired: number;
	deleteStatements: number;
	hasMore: boolean;
	sessionsProcessed: number;
	windows: number;
	windowsScanned: number;
}

export async function retireTranscriptRecordsGenerations(
	executor: ClickHouseExecutor,
	options: {
		readonly deadline?: MaintenanceDeadline;
		readonly maxSessions?: number;
		readonly organizationId?: string;
		readonly maxWindows?: number;
	} = {},
): Promise<TranscriptRecordsRetirementResult> {
	const now = options.deadline?.now ?? Date.now;
	const startedAt = now();
	const maxSessions =
		options.maxSessions ?? TRANSCRIPT_RECORDS_SESSIONS_PER_PASS;
	const reads = createTranscriptRecordsDeadline({
		deadlineAt: Math.min(
			options.deadline?.deadlineAt ?? Infinity,
			startedAt + TRANSCRIPT_RECORDS_READS_TIMEOUT_MS,
		),
		now,
		signal: undefined,
	});
	const byOrganization = new Map<string, Retirement[]>();
	let census: Awaited<
		ReturnType<typeof findTranscriptRecordsRetirementSessions>
	>;
	let capped = false;
	try {
		census = await findTranscriptRecordsRetirementSessions(executor, {
			maxSessions,
			maxWindows:
				options.maxWindows ??
				(options.organizationId === undefined
					? TRANSCRIPT_RECORDS_WINDOWS_PER_PASS
					: undefined),
			organizationId: options.organizationId,
			retireBefore: startedAt - TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
			rotation: Math.floor(startedAt / HOUR_MS),
			signal: reads.signal,
			wait: reads.wait,
		});
		for (const page of organizationPages(census.rows)) {
			const organizationId = page[0]?.organization_id ?? "";
			const selected = await reads.wait(() =>
				selectPageRetirements(
					executor,
					organizationId,
					page,
					startedAt,
					reads.signal,
				),
			);
			const perSession = new Map<string, number>();
			for (const retirement of selected) {
				const key = `${retirement.userId}\u0000${retirement.sessionId}`;
				perSession.set(key, (perSession.get(key) ?? 0) + 1);
			}
			capped ||= [...perSession.values()].some(
				(count) => count >= MAX_RETIRED_GENERATIONS_PER_PASS,
			);
			byOrganization.set(organizationId, [
				...(byOrganization.get(organizationId) ?? []),
				...selected,
			]);
		}
	} finally {
		reads.dispose();
	}
	const result: TranscriptRecordsRetirementResult = {
		retired: 0,
		deleteStatements: 0,
		hasMore: census.hasMore || capped,
		sessionsProcessed: census.rows.length,
		windows: census.windows,
		windowsScanned: census.windowsScanned,
	};
	for (const [organizationId, retirements] of byOrganization) {
		const operations = buildKeyedDeleteOperations({
			table: TRANSCRIPT_RECORDS_TABLE,
			organizationId,
			columns: TRANSCRIPT_RECORDS_GENERATION_COLUMNS,
			keys: retirements.map((retirement) => [
				retirement.userId,
				retirement.sessionId,
				retirement.generation.revision,
				retirement.generation.parserVersion,
			]),
		});
		const outcomes = await runRetirementDeletes(executor, operations, {
			deadline: options.deadline,
		});
		result.deleteStatements += submittedStatements(outcomes);
		for (const outcome of outcomes)
			if (isDeleteSettled(outcome)) result.retired += outcome.keyCount;
		if (outcomes.length < operations.length || !outcomes.every(isDeleteSettled))
			result.hasMore = true;
		if (outcomes.length < operations.length) break;
	}
	return result;
}

function* organizationPages(
	sessions: readonly RetirementSessionRow[],
): Generator<RetirementSessionRow[]> {
	let page: RetirementSessionRow[] = [];
	for (const session of sessions) {
		if (
			page.length >= RETIREMENT_DRAIN_MAX_PAGE_SIZE ||
			(page[0] !== undefined &&
				page[0].organization_id !== session.organization_id)
		) {
			yield page;
			page = [];
		}
		page.push(session);
	}
	if (page.length > 0) yield page;
}
