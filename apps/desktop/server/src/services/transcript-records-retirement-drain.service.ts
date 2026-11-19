import type { ClickHouseExecutor } from "../clickhouse.js";
import { submittedStatements } from "./clickhouse-batched-delete.js";
import {
	deleteRetirements,
	organizationPages,
	RETIREMENT_GRACE_MS,
	RETIREMENT_PAGE_SESSIONS,
	selectRetirements,
} from "./generation-retirement/retirement.js";
import { transcriptRecordsStore } from "./generation-retirement/stores.js";

export const RETIREMENT_DRAIN_MAX_PAGE_SIZE = RETIREMENT_PAGE_SESSIONS;
export const RETIREMENT_DELETE_MAX_EXECUTION_SECONDS = 600;
export const RETIREMENT_DRAIN_REQUEST_TIMEOUT_MS =
	(RETIREMENT_DELETE_MAX_EXECUTION_SECONDS + 60) * 1000;
const CENSUS_SETTINGS = {
	max_bytes_to_read: String(32 * 1024 * 1024 * 1024),
	max_execution_time: 120,
	max_rows_to_read: "1000000000",
	max_memory_usage: String(4 * 1024 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;

export interface TranscriptRecordsRetirementDrainOptions {
	readonly execute: boolean;
	readonly maxSessions: number;
	readonly organizationId?: string;
	readonly pageSize: number;
	readonly pauseMs: number;
	readonly now?: () => number;
	readonly onProgress?: (progress: {
		readonly processedSessions: number;
		readonly totalSessions: number;
		readonly generations: number;
	}) => void;
	readonly signal?: AbortSignal;
	readonly sleep?: (ms: number) => Promise<void>;
}

export interface TranscriptRecordsRetirementDrainResult {
	status: "preview" | "completed";
	organizationId: string | null;
	retireBefore: string;
	sessionCount: number;
	hasMore: boolean;
	sessionsRetired: number;
	sessionsHeld: number;
	generations: number;
	committedGenerations: number;
	uncommittedGenerations: number;
	rows: number;
	deleteStatements: number;
}

export function validateRetirementDrainOptions(
	options: Pick<
		TranscriptRecordsRetirementDrainOptions,
		"maxSessions" | "pageSize" | "pauseMs" | "organizationId"
	>,
): void {
	if (!Number.isSafeInteger(options.maxSessions) || options.maxSessions < 1)
		throw new Error("maxSessions must be a positive integer");
	if (
		!Number.isSafeInteger(options.pageSize) ||
		options.pageSize < 1 ||
		options.pageSize > RETIREMENT_DRAIN_MAX_PAGE_SIZE
	)
		throw new Error(
			`pageSize must be between 1 and ${RETIREMENT_DRAIN_MAX_PAGE_SIZE}`,
		);
	if (!Number.isSafeInteger(options.pauseMs) || options.pauseMs < 0)
		throw new Error("pauseMs must be a non-negative integer");
	if (options.organizationId !== undefined && options.organizationId === "")
		throw new Error("organizationId must not be empty");
}

export async function drainTranscriptRecordsRetirement(
	executor: ClickHouseExecutor,
	options: TranscriptRecordsRetirementDrainOptions,
): Promise<TranscriptRecordsRetirementDrainResult> {
	validateRetirementDrainOptions(options);
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const retireBefore = now() - RETIREMENT_GRACE_MS;
	const census = await transcriptRecordsStore.findSessions(executor, {
		window: {},
		limit: options.maxSessions + 1,
		retireBefore,
		organizationId: options.organizationId,
		signal: options.signal,
		settings: {
			...CENSUS_SETTINGS,
			max_result_rows: String(options.maxSessions + 1),
		},
	});
	const sessions = census.slice(0, options.maxSessions);
	const result: TranscriptRecordsRetirementDrainResult = {
		status: options.execute ? "completed" : "preview",
		organizationId: options.organizationId ?? null,
		retireBefore: new Date(retireBefore).toISOString(),
		sessionCount: sessions.length,
		hasMore: census.length > options.maxSessions,
		sessionsRetired: 0,
		sessionsHeld: 0,
		generations: 0,
		committedGenerations: 0,
		uncommittedGenerations: 0,
		rows: 0,
		deleteStatements: 0,
	};
	let processed = 0;
	for (const page of organizationPages(sessions, options.pageSize)) {
		options.signal?.throwIfAborted();
		const organizationId = page[0]?.organizationId ?? "";
		const { retirements, capped } = await selectRetirements(
			executor,
			transcriptRecordsStore,
			organizationId,
			page,
			now(),
			options.signal,
		);
		result.hasMore ||= capped;
		const retiredSessions = new Set(
			retirements.map(({ session }) => session.key.join("\u0000")),
		);
		result.sessionsRetired += retiredSessions.size;
		result.sessionsHeld += page.length - retiredSessions.size;
		for (const { generation } of retirements) {
			result.generations++;
			if (generation.rows === null) result.uncommittedGenerations++;
			else {
				result.committedGenerations++;
				result.rows += generation.rows;
			}
		}
		if (options.execute && retirements.length > 0) {
			const deleted = await deleteRetirements(
				executor,
				transcriptRecordsStore,
				organizationId,
				retirements,
				{
					signal: options.signal,
					maxExecutionSeconds: RETIREMENT_DELETE_MAX_EXECUTION_SECONDS,
				},
			);
			result.deleteStatements += submittedStatements(deleted.outcomes);
			if (!deleted.settled) {
				result.hasMore = true;
				break;
			}
			if (options.pauseMs > 0) await sleep(options.pauseMs);
		}
		processed += page.length;
		options.onProgress?.({
			processedSessions: processed,
			totalSessions: sessions.length,
			generations: result.generations,
		});
	}
	return result;
}
