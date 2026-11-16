import type { ClickHouseExecutor } from "../../clickhouse.js";
import {
	createMaintenanceQueueDeadline,
	type MaintenanceDeadline,
} from "../../lib/bounded-maintenance.js";
import { type CensusWindow, scanCensusWindows } from "../census-windows.js";
import {
	buildKeyedDeleteOperations,
	type DeleteOperation,
	type DeleteOutcome,
	hasKeyedDeleteTime,
	isDeleteSettled,
	type KeyedDeleteColumn,
	type KeyedDeleteKey,
	reconcileBudget,
	runDeleteOperation,
	submittedStatements,
} from "../clickhouse-batched-delete.js";
import { createTranscriptRecordsDeadline } from "../transcript-records-deadline.js";

export const RETIREMENT_GRACE_MS = 10 * 60_000;
export const MAX_RETIRED_PER_SESSION = 100;
export const RETIREMENT_PAGE_SESSIONS = 100;
const HOUR_MS = 3_600_000;
const STEP_BUDGET_MS = 120_000;

export interface StoredSession {
	readonly organizationId: string;
	readonly key: readonly string[];
}

export interface StoredGeneration {
	readonly key: KeyedDeleteKey;
	readonly committed: boolean;
	readonly publishedAtMs: number | null;
	readonly writtenAtMs: number;
	readonly rows: number | null;
}

export interface SessionGenerations {
	readonly session: StoredSession;
	readonly generations: readonly StoredGeneration[];
}

export interface RetirementPolicy {
	readonly graceMs: number | null;
	readonly abandonedBuilds: boolean;
}

export interface GenerationStore {
	readonly table: string;
	readonly dependents: () => readonly string[];
	readonly sessionColumns: readonly KeyedDeleteColumn[];
	readonly generationColumns: readonly KeyedDeleteColumn[];
	readonly policy: RetirementPolicy;
	readonly census: {
		readonly windowRows: number;
		readonly windowsPerPass: number;
		readonly sessionsPerPass: number;
		readonly readsMs: number;
	};
	findSessions(
		executor: ClickHouseExecutor,
		input: {
			readonly window: CensusWindow;
			readonly limit: number;
			readonly retireBefore: number;
			readonly organizationId?: string;
			readonly signal?: AbortSignal;
			readonly settings?: Record<string, string | number>;
		},
	): Promise<StoredSession[]>;
	readGenerations(
		executor: ClickHouseExecutor,
		organizationId: string,
		sessions: readonly StoredSession[],
		signal?: AbortSignal,
	): Promise<SessionGenerations[]>;
}

export interface Retirement {
	readonly session: StoredSession;
	readonly generation: StoredGeneration;
}

export interface RetirementResult {
	retired: number;
	deleteStatements: number;
	hasMore: boolean;
	sessions: number;
	generations: number;
	windows: number;
	windowsScanned: number;
	outcomes: DeleteOutcome[];
}

export function planRetirement(
	generations: readonly StoredGeneration[],
	policy: RetirementPolicy,
	nowMs: number,
): { retired: StoredGeneration[]; capped: boolean } {
	const newestFirst = [...generations].sort((left, right) =>
		compareKeys(right.key, left.key),
	);
	const committedIndex = newestFirst.findIndex(
		(generation) => generation.committed,
	);
	const graceStart = nowMs - (policy.graceMs ?? 0);
	const abandoned = policy.abandonedBuilds
		? (committedIndex < 0
				? newestFirst
				: newestFirst.slice(0, committedIndex)
			).filter(
				(generation) =>
					!generation.committed && generation.writtenAtMs <= graceStart,
			)
		: [];
	const head = newestFirst[committedIndex];
	const older = newestFirst.slice(committedIndex + 1);
	const superseded =
		head === undefined
			? []
			: policy.graceMs === null
				? older
				: Number.isFinite(head.publishedAtMs)
					? supersededPastGrace(older, head.publishedAtMs ?? 0, graceStart)
					: [];
	const retired = [...abandoned, ...superseded].slice(
		0,
		MAX_RETIRED_PER_SESSION,
	);
	return { retired, capped: retired.length >= MAX_RETIRED_PER_SESSION };
}

function supersededPastGrace(
	older: readonly StoredGeneration[],
	publishedAtMs: number,
	graceStart: number,
): StoredGeneration[] {
	const retired: StoredGeneration[] = [];
	let supersededAtMs = publishedAtMs;
	for (const generation of older) {
		if (!generation.committed) {
			retired.push(generation);
			continue;
		}
		if (supersededAtMs <= graceStart) retired.push(generation);
		supersededAtMs = Number.isFinite(generation.publishedAtMs)
			? (generation.publishedAtMs ?? Number.POSITIVE_INFINITY)
			: Number.POSITIVE_INFINITY;
	}
	return retired;
}

function compareKeys(left: KeyedDeleteKey, right: KeyedDeleteKey): number {
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const a = BigInt(String(left[index] ?? 0));
		const b = BigInt(String(right[index] ?? 0));
		if (a !== b) return a < b ? -1 : 1;
	}
	return 0;
}

export function* organizationPages<
	Session extends { readonly organizationId: string },
>(sessions: readonly Session[], size: number): Generator<Session[]> {
	let page: Session[] = [];
	for (const session of sessions) {
		if (
			page.length >= size ||
			(page[0] !== undefined &&
				page[0].organizationId !== session.organizationId)
		) {
			yield page;
			page = [];
		}
		page.push(session);
	}
	if (page.length > 0) yield page;
}

export async function selectRetirements(
	executor: ClickHouseExecutor,
	store: GenerationStore,
	organizationId: string,
	sessions: readonly StoredSession[],
	nowMs: number,
	signal?: AbortSignal,
): Promise<{ retirements: Retirement[]; capped: boolean }> {
	const read = await store.readGenerations(
		executor,
		organizationId,
		sessions,
		signal,
	);
	const retirements: Retirement[] = [];
	let capped = false;
	for (const { session, generations } of read) {
		const plan = planRetirement(generations, store.policy, nowMs);
		capped ||= plan.capped;
		for (const generation of plan.retired)
			retirements.push({ session, generation });
	}
	return { retirements, capped };
}

export async function deleteRetirements(
	executor: ClickHouseExecutor,
	store: GenerationStore,
	organizationId: string,
	retirements: readonly Retirement[],
	options: {
		readonly deadline?: MaintenanceDeadline;
		readonly signal?: AbortSignal;
		readonly maxExecutionSeconds?: number;
	} = {},
): Promise<{ retired: number; settled: boolean; outcomes: DeleteOutcome[] }> {
	const columns = [...store.sessionColumns, ...store.generationColumns];
	const keys = retirements.map(({ session, generation }) => [
		...session.key,
		...generation.key,
	]);
	const byTable = [...store.dependents(), store.table].map((table) =>
		buildKeyedDeleteOperations({
			table,
			organizationId,
			columns,
			keys,
			maxExecutionSeconds: options.maxExecutionSeconds,
		}),
	);
	const result = {
		retired: 0,
		settled: true,
		outcomes: [] as DeleteOutcome[],
	};
	const chunks = byTable.at(-1)?.length ?? 0;
	for (let chunk = 0; chunk < chunks; chunk++) {
		const operations = byTable
			.map((operations) => operations[chunk])
			.filter(
				(operation): operation is DeleteOperation => operation !== undefined,
			);
		const outcomes = await runChained(executor, operations, options);
		result.outcomes.push(...outcomes);
		const parent = outcomes.at(-1);
		if (
			outcomes.length === operations.length &&
			parent !== undefined &&
			isDeleteSettled(parent)
		)
			result.retired += parent.keyCount;
		else {
			result.settled = false;
			break;
		}
	}
	return result;
}

async function runChained(
	executor: ClickHouseExecutor,
	operations: readonly DeleteOperation[],
	options: { deadline?: MaintenanceDeadline; signal?: AbortSignal },
): Promise<DeleteOutcome[]> {
	const outcomes: DeleteOutcome[] = [];
	for (const operation of operations) {
		options.signal?.throwIfAborted();
		if (!hasKeyedDeleteTime(options.deadline)) break;
		const outcome = await runDeleteOperation(executor, operation, {
			deferWhilePending: true,
			skipWhenNoRows: true,
			reconcileBudgetMs: reconcileBudget(options.deadline),
			signal: options.signal,
		});
		outcomes.push(outcome);
		if (!isDeleteSettled(outcome)) break;
	}
	return outcomes;
}

export async function retireGenerations(
	executor: ClickHouseExecutor,
	store: GenerationStore,
	options: {
		readonly deadline?: MaintenanceDeadline;
		readonly organizationId?: string;
		readonly maxSessions?: number;
		readonly maxWindows?: number;
		readonly signal?: AbortSignal;
	} = {},
): Promise<RetirementResult> {
	const now = options.deadline?.now ?? Date.now;
	const startedAt = now();
	const maxSessions = options.maxSessions ?? store.census.sessionsPerPass;
	if (!Number.isSafeInteger(maxSessions) || maxSessions < 1)
		throw new Error("maxSessions must be a positive integer");
	const reads = createTranscriptRecordsDeadline({
		deadlineAt: Math.min(
			options.deadline?.deadlineAt ?? Number.POSITIVE_INFINITY,
			startedAt + store.census.readsMs,
		),
		now,
		signal: options.signal,
	});
	try {
		const scan = await scanCensusWindows<StoredSession>(executor, {
			table: store.table,
			windowRows: store.census.windowRows,
			limit: maxSessions,
			organizationId: options.organizationId,
			maxWindows:
				options.maxWindows ??
				(options.organizationId === undefined
					? store.census.windowsPerPass
					: undefined),
			rotation: Math.floor(startedAt / HOUR_MS),
			signal: reads.signal,
			wait: reads.wait,
			read: (window, limit, signal) =>
				store.findSessions(executor, {
					window,
					limit,
					retireBefore: startedAt - (store.policy.graceMs ?? 0),
					organizationId: options.organizationId,
					signal,
				}),
		});
		const sessions = scan.rows.slice(0, maxSessions);
		const result: RetirementResult = {
			retired: 0,
			deleteStatements: 0,
			hasMore: scan.hasMore,
			sessions: sessions.length,
			generations: 0,
			windows: scan.windows,
			windowsScanned: scan.windowsScanned,
			outcomes: [],
		};
		for (const page of organizationPages(sessions, RETIREMENT_PAGE_SESSIONS)) {
			if (!hasKeyedDeleteTime(options.deadline)) {
				result.hasMore = true;
				break;
			}
			const organizationId = page[0]?.organizationId ?? "";
			const { retirements, capped } = await reads.wait(() =>
				selectRetirements(
					executor,
					store,
					organizationId,
					page,
					startedAt,
					reads.signal,
				),
			);
			result.hasMore ||= capped;
			result.generations += retirements.length;
			const deleted = await deleteRetirements(
				executor,
				store,
				organizationId,
				retirements,
				{ deadline: options.deadline, signal: options.signal },
			);
			result.retired += deleted.retired;
			result.outcomes.push(...deleted.outcomes);
			result.deleteStatements += submittedStatements(deleted.outcomes);
			if (!deleted.settled) {
				result.hasMore = true;
				break;
			}
		}
		return result;
	} finally {
		reads.dispose();
	}
}

export interface RetirementStepResult {
	status: "ok" | "failed";
	retired: number;
	deleteStatements: number;
	hasMore: boolean;
	error?: string;
}

export async function runRetirementPass<Name extends string>(options: {
	readonly executor: ClickHouseExecutor;
	readonly deadline: MaintenanceDeadline;
	readonly stores: readonly (readonly [Name, GenerationStore])[];
}): Promise<Record<Name, RetirementStepResult>> {
	const { executor, deadline, stores } = options;
	const first = new Date(deadline.now()).getUTCHours() % stores.length;
	const results = {} as Record<Name, RetirementStepResult>;
	for (const [name, store] of [
		...stores.slice(first),
		...stores.slice(0, first),
	]) {
		try {
			const result = await retireGenerations(executor, store, {
				deadline: createMaintenanceQueueDeadline(deadline, STEP_BUDGET_MS),
			});
			results[name] = {
				status: "ok",
				retired: result.retired,
				deleteStatements: result.deleteStatements,
				hasMore: result.hasMore,
			};
		} catch (error) {
			results[name] = {
				status: "failed",
				retired: 0,
				deleteStatements: 0,
				hasMore: true,
				error: error instanceof Error ? error.message.slice(0, 512) : "failed",
			};
		}
	}
	return results;
}
