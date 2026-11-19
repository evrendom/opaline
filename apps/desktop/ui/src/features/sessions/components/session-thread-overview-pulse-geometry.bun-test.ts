import { describe, expect, test } from "bun:test";
import { resolveSessionThreadOverviewStripConfig } from "./session-thread-overview-config";
import type { SessionOverviewCallSeries } from "./session-thread-overview-model";
import {
	getPulseCallInputUtilization,
	getPulseCallNearX,
} from "./session-thread-overview-pulse-geometry";

const config = resolveSessionThreadOverviewStripConfig({
	chartWidth: 1_000,
	plotPadding: 0,
});

const series: SessionOverviewCallSeries = {
	aggregates: {
		largestCallInputTotal: 200,
		largestTurnInputTotal: 300,
		modelContextLimits: [],
	},
	turns: [
		{
			calls: [
				{
					cacheCreation: 0,
					cacheRead: 0,
					fresh: 100,
					inputTotal: 100,
					model: "first",
					timestampMs: 1_000,
					xRatio: 0.1,
				},
				{
					cacheCreation: 0,
					cacheRead: 0,
					fresh: 200,
					inputTotal: 200,
					model: "second",
					timestampMs: 2_000,
					xRatio: 0.9,
				},
			],
			index: 0,
			inputTotal: 300,
			xEndRatio: 1,
			xStartRatio: 0,
		},
	],
};

describe("nearest Pulse call hover", () => {
	test("positioning event dots does not rescan every call for each dot", () => {
		let reads = 0;
		const measured: SessionOverviewCallSeries = {
			...series,
			turns: series.turns.map((turn) => ({
				...turn,
				calls: turn.calls.map((call) => ({
					...call,
					get inputTotal() {
						reads += 1;
						return call.inputTotal;
					},
				})),
			})),
		};
		const call = series.turns[0]?.calls[0];
		if (!call) throw new Error("Expected a call");
		for (let dot = 0; dot < 100; dot += 1) {
			expect(getPulseCallInputUtilization(measured, call).maximum).toBeCloseTo(
				224,
			);
		}
		expect(reads).toBe(0);
	});

	test("does not attach an isolated activity circle to a distant call", () => {
		expect(getPulseCallNearX(series, config, 500, 0)).toBeUndefined();
		expect(getPulseCallNearX(series, config, 104, 0)?.call.model).toBe("first");
	});

	test("reports the same context utilization used to position a call", () => {
		const call = series.turns[0]?.calls[0];
		if (!call) {
			throw new Error("Expected a model call");
		}

		expect(
			getPulseCallInputUtilization(series, {
				...call,
				inputTotal: 100,
				modelContextWindow: 400,
			}),
		).toEqual({ maximum: 400, percentage: 25 });
	});
});
