import type {
	ClickHouseObserverConfig,
	ClickHousePartSnapshot,
} from "./clickhouse-observer.ts";
import type { RequestMeasurement } from "./http.ts";
import type { LoadedTranscriptManifest } from "./manifest.ts";
import type { RssSummary } from "./rss.ts";

export interface RunThresholds {
	readonly maxClickHousePartDelta: number | null;
	readonly maxE2eP95Ms: number | null;
	readonly maxFailures: number;
	readonly maxFirstCommitP95Ms: number | null;
	readonly maxNonTerminalJobs: number;
	readonly maxPeakRssBytes: number | null;
	readonly maxScheduleDriftMs: number | null;
	readonly maxTransportFailures: number;
	readonly minAchievedStartRate: number | null;
}

export interface RunOptions {
	readonly apiKey: string;
	readonly barrierBeforeCommit: boolean;
	readonly baseUrl: URL;
	readonly clickHouseObserver: ClickHouseObserverConfig | null;
	readonly clickHouseSettleMs: number;
	readonly commitAttempts: number;
	readonly concurrency: number;
	readonly manifest: LoadedTranscriptManifest;
	readonly maxInFlight: number;
	readonly organizationId: string | undefined;
	readonly partConcurrency: number;
	readonly processingPids: readonly number[];
	readonly ratePerSecond: number | null;
	readonly requestTimeoutMs: number;
	readonly sameSessionHash: boolean;
	readonly scenarioName: string;
	readonly statusWaitMs: number;
	readonly summaryPath: string;
	readonly thresholds: RunThresholds;
	readonly uploads: number;
}

export type FinalJobStatus =
	| "completed"
	| "failed"
	| "pending"
	| "running"
	| "unavailable";

export interface UploadResult {
	readonly classification:
		| "completed"
		| "init_failed"
		| "multipart_failed"
		| "commit_failed"
		| "status_failed";
	readonly commitAttempts: number;
	readonly e2eMs: number;
	readonly errorCode: string | null;
	readonly errorMessage: string | null;
	readonly finalStatus: FinalJobStatus;
	readonly firstCommitMs: number | null;
	readonly index: number;
	readonly initMs: number;
	readonly jobId: string | null;
	readonly multipartMs: number;
	readonly nonTerminal: boolean;
	readonly nonTerminalReason: string | null;
	readonly plannedStartOffsetMs: number | null;
	readonly scheduleDriftMs: number | null;
	readonly sessionId: string;
	readonly startedOffsetMs: number;
}

export interface ThresholdResult {
	readonly comparison: "at_least" | "at_most";
	readonly limit: number;
	readonly name: string;
	readonly observed: number | null;
	readonly passed: boolean;
	readonly unit: "bytes" | "count" | "milliseconds" | "starts/second";
}

export interface LoadTestSummary {
	readonly clickHouse: {
		readonly after: ClickHousePartSnapshot | null;
		readonly before: ClickHousePartSnapshot | null;
		readonly partDelta: number | null;
	};
	readonly configuration: {
		readonly aggregateBytesPerUpload: number;
		readonly barrierBeforeCommit: boolean;
		readonly baseOrigin: string;
		readonly commitAttempts: number;
		readonly concurrency: number;
		readonly entropy: string;
		readonly maxInFlight: number;
		readonly partConcurrency: number;
		readonly ratePerSecond: number | null;
		readonly sameSessionHash: boolean;
		readonly source: string;
		readonly subagentCount: number;
		readonly timestampLines: number;
		readonly uploads: number;
	};
	readonly durationMs: number;
	readonly formatVersion: 2;
	readonly passed: boolean;
	readonly requestMeasurements: readonly RequestMeasurement[];
	readonly rss: RssSummary;
	readonly scenarioName: string;
	readonly startSchedule: {
		readonly achievedStartRate: number | null;
		readonly maxScheduleDriftMs: number | null;
	};
	readonly thresholdResults: readonly ThresholdResult[];
	readonly totals: {
		readonly completed: number;
		readonly failed: number;
		readonly nonTerminalJobs: number;
		readonly requests: number;
		readonly uploadedBytes: number;
	};
	readonly uploads: readonly UploadResult[];
}
