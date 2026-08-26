import type { ClickHousePartSnapshot } from "./clickhouse-observer.ts";
import type { RequestMeasurement } from "./http.ts";
import type { RssSummary } from "./rss.ts";
import type {
	LoadTestSummary,
	RunOptions,
	ThresholdResult,
	UploadResult,
} from "./run-types.ts";

export function buildLoadTestSummary(input: {
	readonly clickHouseAfter: ClickHousePartSnapshot | null;
	readonly clickHouseBefore: ClickHousePartSnapshot | null;
	readonly durationMs: number;
	readonly measurements: readonly RequestMeasurement[];
	readonly options: RunOptions;
	readonly results: readonly UploadResult[];
	readonly rss: RssSummary;
}): LoadTestSummary {
	const completed = input.results.filter(
		(result) => result.finalStatus === "completed",
	).length;
	const failed = input.options.uploads - completed;
	const nonTerminalJobs = input.results.filter(
		(result) => result.nonTerminal,
	).length;
	const startSchedule = summarizeStartSchedule(
		input.results,
		input.options.ratePerSecond,
	);
	const e2eP95 = percentile(
		input.results.map((result) => result.e2eMs),
		0.95,
	);
	const firstCommitP95 = percentile(
		input.results.flatMap((result) =>
			result.firstCommitMs === null ? [] : [result.firstCommitMs],
		),
		0.95,
	);
	const partDelta =
		input.clickHouseBefore && input.clickHouseAfter
			? input.clickHouseAfter.activeParts - input.clickHouseBefore.activeParts
			: null;
	const thresholdResults = buildThresholdResults({
		achievedStartRate: startSchedule.achievedStartRate,
		clickHousePartErrors: input.measurements.filter(isTooManyPartsFailure)
			.length,
		e2eP95,
		failed,
		firstCommitP95,
		maxScheduleDriftMs: startSchedule.maxScheduleDriftMs,
		nonTerminalJobs,
		options: input.options,
		partDelta,
		rss: input.rss,
		transportFailures: input.measurements.filter(
			(measurement) =>
				measurement.classification === "network_error" ||
				measurement.classification === "timeout",
		).length,
	});

	return {
		clickHouse: {
			after: input.clickHouseAfter,
			before: input.clickHouseBefore,
			partDelta,
		},
		configuration: {
			aggregateBytesPerUpload: input.options.manifest.manifest.aggregateBytes,
			barrierBeforeCommit: input.options.barrierBeforeCommit,
			baseOrigin: input.options.baseUrl.origin,
			commitAttempts: input.options.commitAttempts,
			concurrency: input.options.concurrency,
			entropy: input.options.manifest.manifest.entropy,
			maxInFlight: input.options.maxInFlight,
			partConcurrency: input.options.partConcurrency,
			ratePerSecond: input.options.ratePerSecond,
			sameSessionHash: input.options.sameSessionHash,
			source: input.options.manifest.manifest.metadata.source,
			subagentCount: input.options.manifest.manifest.subagentCount,
			timestampLines: input.options.manifest.manifest.timestampLines,
			uploads: input.options.uploads,
		},
		durationMs: input.durationMs,
		formatVersion: 2,
		passed: thresholdResults.every((result) => result.passed),
		requestMeasurements: [...input.measurements].sort(
			(left, right) => left.startedOffsetMs - right.startedOffsetMs,
		),
		rss: input.rss,
		scenarioName: input.options.scenarioName,
		startSchedule,
		thresholdResults,
		totals: {
			completed,
			failed,
			nonTerminalJobs,
			requests: input.measurements.length,
			uploadedBytes: input.measurements
				.filter(
					(measurement) =>
						measurement.phase === "r2_part" &&
						measurement.classification === "success",
				)
				.reduce((total, measurement) => total + measurement.bytesSent, 0),
		},
		uploads: [...input.results].sort((left, right) => left.index - right.index),
	};
}

export function printLoadTestTables(
	summary: LoadTestSummary,
	summaryPath: string,
): void {
	const uploadRows = summary.uploads.map((upload) => ({
		"commit tries": upload.commitAttempts,
		"e2e ms": formatNumber(upload.e2eMs),
		"first commit ms": formatOptionalNumber(upload.firstCommitMs),
		index: upload.index,
		"init ms": formatNumber(upload.initMs),
		"multipart ms": formatNumber(upload.multipartMs),
		"non-terminal": upload.nonTerminal ? "YES" : "no",
		"schedule drift ms": formatOptionalNumber(upload.scheduleDriftMs),
		status: upload.finalStatus,
	}));
	const thresholdRows = summary.thresholdResults.map((threshold) => ({
		limit: `${threshold.comparison === "at_least" ? "≥" : "≤"} ${formatNumber(threshold.limit)} ${threshold.unit}`,
		observed:
			threshold.observed === null
				? "not measured"
				: `${formatNumber(threshold.observed)} ${threshold.unit}`,
		result: threshold.passed ? "PASS" : "FAIL",
		threshold: threshold.name,
	}));

	console.log(`\nScenario: ${summary.scenarioName}`);
	console.table(uploadRows);
	console.table(thresholdRows);
	console.log(
		`Overall: ${summary.passed ? "PASS" : "FAIL"} | completed=${summary.totals.completed}/${summary.configuration.uploads} non-terminal=${summary.totals.nonTerminalJobs} duration=${formatNumber(summary.durationMs)} ms`,
	);
	console.log(`JSON summary: ${summaryPath}`);
}

function summarizeStartSchedule(
	results: readonly UploadResult[],
	ratePerSecond: number | null,
): LoadTestSummary["startSchedule"] {
	if (ratePerSecond === null || results.length === 0) {
		return { achievedStartRate: null, maxScheduleDriftMs: null };
	}
	const plannedStartOffsets = results.flatMap((result) =>
		result.plannedStartOffsetMs === null ? [] : [result.plannedStartOffsetMs],
	);
	const scheduleDrifts = results.flatMap((result) =>
		result.scheduleDriftMs === null ? [] : [result.scheduleDriftMs],
	);
	if (
		plannedStartOffsets.length !== results.length ||
		scheduleDrifts.length !== results.length
	) {
		return { achievedStartRate: null, maxScheduleDriftMs: null };
	}
	const firstPlannedStartMs = Math.min(...plannedStartOffsets);
	const lastActualStartMs = Math.max(
		...results.map((result) => result.startedOffsetMs),
	);
	const scheduleWindowMs =
		lastActualStartMs - firstPlannedStartMs + 1_000 / ratePerSecond;
	return {
		achievedStartRate:
			scheduleWindowMs > 0 ? (results.length * 1_000) / scheduleWindowMs : null,
		maxScheduleDriftMs: Math.max(...scheduleDrifts),
	};
}

export function percentile(
	values: readonly number[],
	quantile: number,
): number | null {
	if (values.length === 0) return null;
	if (!(quantile > 0 && quantile <= 1)) {
		throw new Error(
			"Percentile quantile must be greater than zero and at most one",
		);
	}
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.ceil(quantile * sorted.length) - 1;
	return sorted[index] ?? null;
}

function buildThresholdResults(input: {
	readonly achievedStartRate: number | null;
	readonly clickHousePartErrors: number;
	readonly e2eP95: number | null;
	readonly failed: number;
	readonly firstCommitP95: number | null;
	readonly maxScheduleDriftMs: number | null;
	readonly nonTerminalJobs: number;
	readonly options: RunOptions;
	readonly partDelta: number | null;
	readonly rss: RssSummary;
	readonly transportFailures: number;
}): ThresholdResult[] {
	const results: ThresholdResult[] = [
		createMaximumThreshold(
			"failed uploads",
			input.failed,
			input.options.thresholds.maxFailures,
			"count",
		),
		createMaximumThreshold(
			"non-terminal jobs",
			input.nonTerminalJobs,
			input.options.thresholds.maxNonTerminalJobs,
			"count",
		),
		createMaximumThreshold(
			"transport failures",
			input.transportFailures,
			input.options.thresholds.maxTransportFailures,
			"count",
		),
		createMaximumThreshold(
			"ClickHouse too-many-parts errors",
			input.clickHousePartErrors,
			0,
			"count",
		),
	];
	appendOptionalMinimumThreshold(
		results,
		"achieved start rate",
		input.achievedStartRate,
		input.options.thresholds.minAchievedStartRate,
		"starts/second",
	);
	appendOptionalMaximumThreshold(
		results,
		"maximum schedule drift",
		input.maxScheduleDriftMs,
		input.options.thresholds.maxScheduleDriftMs,
		"milliseconds",
	);
	appendOptionalMaximumThreshold(
		results,
		"end-to-end p95",
		input.e2eP95,
		input.options.thresholds.maxE2eP95Ms,
		"milliseconds",
	);
	appendOptionalMaximumThreshold(
		results,
		"first commit p95",
		input.firstCommitP95,
		input.options.thresholds.maxFirstCommitP95Ms,
		"milliseconds",
	);
	appendOptionalMaximumThreshold(
		results,
		"processing peak RSS",
		input.rss.peakTotalBytes,
		input.options.thresholds.maxPeakRssBytes,
		"bytes",
	);
	appendOptionalMaximumThreshold(
		results,
		"ClickHouse active part delta",
		input.partDelta,
		input.options.thresholds.maxClickHousePartDelta,
		"count",
	);
	return results;
}

function appendOptionalMaximumThreshold(
	results: ThresholdResult[],
	name: string,
	observed: number | null,
	limit: number | null,
	unit: ThresholdResult["unit"],
): void {
	if (limit === null) return;
	results.push(createMaximumThreshold(name, observed, limit, unit));
}

function appendOptionalMinimumThreshold(
	results: ThresholdResult[],
	name: string,
	observed: number | null,
	limit: number | null,
	unit: ThresholdResult["unit"],
): void {
	if (limit === null) return;
	results.push(createMinimumThreshold(name, observed, limit, unit));
}

function createMaximumThreshold(
	name: string,
	observed: number | null,
	limit: number,
	unit: ThresholdResult["unit"],
): ThresholdResult {
	return {
		comparison: "at_most",
		limit,
		name,
		observed,
		passed: observed !== null && observed <= limit,
		unit,
	};
}

function createMinimumThreshold(
	name: string,
	observed: number | null,
	limit: number,
	unit: ThresholdResult["unit"],
): ThresholdResult {
	return {
		comparison: "at_least",
		limit,
		name,
		observed,
		passed: observed !== null && observed >= limit,
		unit,
	};
}

function formatOptionalNumber(value: number | null): string {
	return value === null ? "—" : formatNumber(value);
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function isTooManyPartsFailure(measurement: RequestMeasurement): boolean {
	const detail = `${measurement.errorCode ?? ""} ${measurement.errorMessage ?? ""}`;
	return /too[_ ]many[_ ]parts/iu.test(detail);
}
