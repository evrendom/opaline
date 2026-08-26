import { describe, expect, test } from "bun:test";
import { strict as assert } from "node:assert";
import type { ResolvedTranscriptObject } from "../src/manifest.ts";
import type {
	LoadTestSummary,
	RunOptions,
	UploadResult,
} from "../src/run-types.ts";
import {
	calculatePlannedStartMs,
	type ScheduledOperationResult,
	type SchedulerClock,
	scheduleOpenLoop,
} from "../src/scheduler.ts";
import { buildLoadTestSummary } from "../src/summary.ts";

interface FastClock extends SchedulerClock {
	readonly elapse: (milliseconds: number) => Promise<void>;
}

describe("open-loop scheduler", () => {
	test("computes fixed planned starts from one epoch and rate", () => {
		expect(calculatePlannedStartMs(2_000, 0, 10)).toBe(2_000);
		expect(calculatePlannedStartMs(2_000, 1, 10)).toBe(2_100);
		expect(calculatePlannedStartMs(2_000, 7, 4)).toBe(3_750);
	});

	test("records actual start minus planned start as schedule drift", async () => {
		const clock = createFastClock(1_000, 7);
		const scheduled = await scheduleOpenLoop(
			{ maxInFlight: 8, operationCount: 3, ratePerSecond: 4 },
			async (start) => start.index,
			clock,
		);

		expect(scheduled.map((item) => item.plannedStartMs)).toEqual([
			1_000, 1_250, 1_500,
		]);
		expect(scheduled.map((item) => item.actualStartMs)).toEqual([
			1_000, 1_257, 1_507,
		]);
		expect(scheduled.map((item) => item.scheduleDriftMs)).toEqual([0, 7, 7]);
		const summary = createScheduleSummary(scheduled, null, 5);
		const threshold = summary.thresholdResults.find(
			(result) => result.name === "maximum schedule drift",
		);
		assert(threshold);
		expect(threshold.passed).toBe(false);
		expect(summary.passed).toBe(false);
	});

	test("starts scheduled operations without waiting for earlier completions", async () => {
		const clock = createFastClock();
		let release: (() => void) | undefined;
		const allStarted = new Promise<void>((resolve) => {
			release = resolve;
		});
		let active = 0;
		let peakActive = 0;
		const scheduled = await scheduleOpenLoop(
			{ maxInFlight: 3, operationCount: 3, ratePerSecond: 10 },
			async (start) => {
				active += 1;
				peakActive = Math.max(peakActive, active);
				if (start.index === 2) {
					assert(release);
					release();
				}
				await allStarted;
				active -= 1;
				return start.index;
			},
			clock,
		);

		expect(peakActive).toBe(3);
		expect(scheduled.map((operation) => operation.actualStartMs)).toEqual([
			0, 100, 200,
		]);
	});

	test("fails the achieved-rate threshold when starts fall behind", async () => {
		const clock = createFastClock();
		const scheduled = await scheduleOpenLoop(
			{ maxInFlight: 2, operationCount: 6, ratePerSecond: 10 },
			async (start) => {
				await clock.elapse(1_000);
				return start.index;
			},
			clock,
		);
		const summary = createScheduleSummary(scheduled, 9.5, null);

		const achievedRate = summary.startSchedule.achievedStartRate;
		assert(achievedRate !== null);
		expect(achievedRate).toBeLessThan(9.5);
		const threshold = summary.thresholdResults.find(
			(result) => result.name === "achieved start rate",
		);
		assert(threshold);
		expect(threshold.passed).toBe(false);
		expect(summary.passed).toBe(false);
	});
});

function createFastClock(initialMs = 0, oversleepMs = 0): FastClock {
	let currentMs = initialMs;
	return {
		elapse: async (milliseconds) => {
			await Promise.resolve();
			currentMs += milliseconds;
		},
		now: () => currentMs,
		sleep: async (milliseconds) => {
			currentMs += milliseconds + oversleepMs;
		},
	};
}

function toCompletedUploadResult(
	operation: ScheduledOperationResult<number>,
): UploadResult {
	return {
		classification: "completed",
		commitAttempts: 1,
		e2eMs: 1_000,
		errorCode: null,
		errorMessage: null,
		finalStatus: "completed",
		firstCommitMs: 100,
		index: operation.index,
		initMs: 10,
		jobId: `job-${operation.index}`,
		multipartMs: 20,
		nonTerminal: false,
		nonTerminalReason: null,
		plannedStartOffsetMs: operation.plannedStartMs,
		scheduleDriftMs: operation.scheduleDriftMs,
		sessionId: `session-${operation.index}`,
		startedOffsetMs: operation.actualStartMs,
	};
}

function createScheduleSummary(
	scheduled: readonly ScheduledOperationResult<number>[],
	minAchievedStartRate: number | null,
	maxScheduleDriftMs: number | null,
): LoadTestSummary {
	const results = scheduled.map(toCompletedUploadResult);
	return buildLoadTestSummary({
		clickHouseAfter: null,
		clickHouseBefore: null,
		durationMs: Math.max(
			...scheduled.map((operation) => operation.actualStartMs),
		),
		measurements: [],
		options: createRunOptions(
			results.length,
			minAchievedStartRate,
			maxScheduleDriftMs,
		),
		results,
		rss: {
			measured: false,
			peakTotalBytes: null,
			processes: [],
			sampleCount: 0,
		},
	});
}

function createRunOptions(
	uploads: number,
	minAchievedStartRate: number | null,
	maxScheduleDriftMs: number | null,
): RunOptions {
	const object: ResolvedTranscriptObject = {
		agentId: null,
		absolutePath: "/tmp/main.jsonl",
		byteLength: 1,
		kind: "main",
		path: "main.jsonl",
		sha256: "0".repeat(64),
	};
	return {
		apiKey: "test-key",
		barrierBeforeCommit: false,
		baseUrl: new URL("http://127.0.0.1:4010"),
		clickHouseObserver: null,
		clickHouseSettleMs: 0,
		commitAttempts: 1,
		concurrency: 1,
		manifest: {
			directory: "/tmp",
			manifest: {
				aggregateBytes: 1,
				entropy: "low",
				manifestVersion: 1,
				metadata: {
					projectPath: "/tmp/project",
					sessionId: "scheduler-test",
					source: "claude_code",
					upload_mode: "manual",
				},
				objects: [object],
				seed: "scheduler-test",
				subagentCount: 0,
				timestampLines: 1,
				timestampStart: "2026-08-25T12:00:00.000Z",
			},
			objects: [object],
		},
		maxInFlight: 2,
		organizationId: undefined,
		partConcurrency: 1,
		processingPids: [],
		ratePerSecond: 10,
		requestTimeoutMs: 1_000,
		sameSessionHash: false,
		scenarioName: "scheduler-test",
		statusWaitMs: 0,
		summaryPath: "/tmp/scheduler-test-summary.json",
		thresholds: {
			maxClickHousePartDelta: null,
			maxE2eP95Ms: null,
			maxFailures: 0,
			maxFirstCommitP95Ms: null,
			maxNonTerminalJobs: 0,
			maxPeakRssBytes: null,
			maxScheduleDriftMs,
			maxTransportFailures: 0,
			minAchievedStartRate,
		},
		uploads,
	};
}
