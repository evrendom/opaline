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
	const orphaned = input.results.filter((result) => result.orphaned).length;
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
		clickHousePartErrors: input.measurements.filter(isTooManyPartsFailure)
			.length,
		e2eP95,
		failed,
		firstCommitP95,
		options: input.options,
		orphaned,
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
			partConcurrency: input.options.partConcurrency,
			ratePerSecond: input.options.ratePerSecond,
			sameSessionHash: input.options.sameSessionHash,
			source: input.options.manifest.manifest.metadata.source,
			subagentCount: input.options.manifest.manifest.subagentCount,
			timestampLines: input.options.manifest.manifest.timestampLines,
			uploads: input.options.uploads,
		},
		durationMs: input.durationMs,
		formatVersion: 1,
		passed: thresholdResults.every((result) => result.passed),
		requestMeasurements: [...input.measurements].sort(
			(left, right) => left.startedOffsetMs - right.startedOffsetMs,
		),
		rss: input.rss,
		scenarioName: input.options.scenarioName,
		thresholdResults,
		totals: {
			completed,
			failed,
			orphaned,
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
		orphaned: upload.orphaned ? "YES" : "no",
		status: upload.finalStatus,
	}));
	const thresholdRows = summary.thresholdResults.map((threshold) => ({
		limit: `${formatNumber(threshold.limit)} ${threshold.unit}`,
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
		`Overall: ${summary.passed ? "PASS" : "FAIL"} | completed=${summary.totals.completed}/${summary.configuration.uploads} orphaned=${summary.totals.orphaned} duration=${formatNumber(summary.durationMs)} ms`,
	);
	console.log(`JSON summary: ${summaryPath}`);
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
	readonly clickHousePartErrors: number;
	readonly e2eP95: number | null;
	readonly failed: number;
	readonly firstCommitP95: number | null;
	readonly options: RunOptions;
	readonly orphaned: number;
	readonly partDelta: number | null;
	readonly rss: RssSummary;
	readonly transportFailures: number;
}): ThresholdResult[] {
	const results: ThresholdResult[] = [
		createThreshold(
			"failed uploads",
			input.failed,
			input.options.thresholds.maxFailures,
			"count",
		),
		createThreshold(
			"orphaned uploads",
			input.orphaned,
			input.options.thresholds.maxOrphaned,
			"count",
		),
		createThreshold(
			"transport failures",
			input.transportFailures,
			input.options.thresholds.maxTransportFailures,
			"count",
		),
		createThreshold(
			"ClickHouse too-many-parts errors",
			input.clickHousePartErrors,
			0,
			"count",
		),
	];
	appendOptionalThreshold(
		results,
		"end-to-end p95",
		input.e2eP95,
		input.options.thresholds.maxE2eP95Ms,
		"milliseconds",
	);
	appendOptionalThreshold(
		results,
		"first commit p95",
		input.firstCommitP95,
		input.options.thresholds.maxFirstCommitP95Ms,
		"milliseconds",
	);
	appendOptionalThreshold(
		results,
		"processing peak RSS",
		input.rss.peakTotalBytes,
		input.options.thresholds.maxPeakRssBytes,
		"bytes",
	);
	appendOptionalThreshold(
		results,
		"ClickHouse active part delta",
		input.partDelta,
		input.options.thresholds.maxClickHousePartDelta,
		"count",
	);
	return results;
}

function appendOptionalThreshold(
	results: ThresholdResult[],
	name: string,
	observed: number | null,
	limit: number | null,
	unit: ThresholdResult["unit"],
): void {
	if (limit === null) return;
	results.push(createThreshold(name, observed, limit, unit));
}

function createThreshold(
	name: string,
	observed: number | null,
	limit: number,
	unit: ThresholdResult["unit"],
): ThresholdResult {
	return {
		limit,
		name,
		observed,
		passed: observed !== null && observed <= limit,
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
