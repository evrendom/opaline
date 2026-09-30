import { describe, expect, test } from "bun:test";
import { extractTranscriptUsageMetrics } from "../session-transcript/session-turn-metadata.js";

function codexTranscript(
	requests: readonly {
		at: string;
		infoTier?: unknown;
		payloadTier?: unknown;
	}[],
	model = "gpt-6-astra",
	modelProvider = "openai",
) {
	return [
		{ type: "session_meta", payload: { model_provider: modelProvider } },
		// Requested Fast is not evidence of the tier actually billed.
		{ type: "turn_context", payload: { model, service_tier: "fast" } },
		...requests.map((request, index) => ({
			type: "event_msg",
			timestamp: request.at,
			payload: {
				type: "token_count",
				service_tier: request.payloadTier,
				info: {
					service_tier: request.infoTier,
					last_token_usage: {
						input_tokens: 150_000,
						cached_input_tokens: 50_000,
						output_tokens: 10_000,
					},
					total_token_usage: {
						input_tokens: 150_000 * (index + 1),
						cached_input_tokens: 50_000 * (index + 1),
						output_tokens: 10_000 * (index + 1),
					},
				},
			},
		})),
	]
		.map((entry) => JSON.stringify(entry))
		.join("\n");
}

function claudeTranscript(model: string, usage: Record<string, unknown>) {
	return JSON.stringify({
		type: "assistant",
		timestamp: "2026-09-12T12:00:00Z",
		message: {
			id: "message-1",
			model,
			usage: { input_tokens: 100_000, output_tokens: 10_000, ...usage },
		},
	});
}

const AT = "2026-09-12T12:00:00Z";

describe("request billing metadata", () => {
	test("prices Fast and legacy Priority per request and respects standard fallback", () => {
		const metrics = extractTranscriptUsageMetrics(
			codexTranscript([
				{ at: AT, infoTier: "fast" },
				{ at: AT, payloadTier: " PRIORITY " },
				{ at: AT, infoTier: "default", payloadTier: "fast" },
				{ at: AT },
			]),
			undefined,
		);
		// Each standard request is $1.55; only the first two get the 2x premium.
		expect(metrics.estimatedCost).toBeCloseTo(9.3, 8);
		expect(metrics.usageEvents.map((event) => event.serviceTier)).toEqual([
			"fast",
			" PRIORITY ",
			"default",
			undefined,
		]);
		expect(metrics.inputTokens).toBe(600_000);
	});

	test("uses each Fast request's date across Sol's price change", () => {
		const metrics = extractTranscriptUsageMetrics(
			codexTranscript(
				[
					{ at: "2026-08-20T23:59:59.999Z", infoTier: "fast" },
					{ at: "2026-08-21T00:00:00Z", infoTier: "fast" },
				],
				"gpt-5.6-sol",
			),
			undefined,
		);
		// Old: 2 * (0.5 + 0.025 + 0.3). New: 2 * (0.4 + 0.02 + 0.2).
		expect(metrics.estimatedCost).toBeCloseTo(2.89, 8);
	});

	test("prices Astra Ultrafast at 6x only from its release date", () => {
		const released = extractTranscriptUsageMetrics(
			codexTranscript([{ at: "2026-09-29T00:00:00Z", infoTier: "ultrafast" }]),
			undefined,
		);
		// A standard request is $1.55.
		expect(released.estimatedCost).toBeCloseTo(9.3, 8);

		const beforeRelease = extractTranscriptUsageMetrics(
			codexTranscript([
				{ at: "2026-09-28T23:59:59.999Z", infoTier: "ultrafast" },
			]),
			undefined,
		);
		expect(beforeRelease.estimatedCost).toBeUndefined();
		expect(beforeRelease.inputTokens).toBe(150_000);
	});

	test("keeps unsupported and malformed explicit tiers unpriced without losing tokens", () => {
		for (const infoTier of ["future-tier", "flex", { mode: "fast" }]) {
			const metrics = extractTranscriptUsageMetrics(
				codexTranscript([{ at: AT, infoTier }]),
				undefined,
			);
			expect(metrics.estimatedCost).toBeUndefined();
			expect(metrics.inputTokens).toBe(150_000);
			expect(metrics.usageEvents).toHaveLength(1);
		}
	});

	test("does not apply OpenAI prices to a different recorded provider", () => {
		const metrics = extractTranscriptUsageMetrics(
			codexTranscript(
				[{ at: AT, infoTier: "fast" }],
				"gpt-6-astra",
				"custom-provider",
			),
			undefined,
		);
		expect(metrics.estimatedCost).toBeUndefined();
		expect(metrics.usageEvents[0]?.modelProvider).toBe("custom-provider");
	});

	test("uses Claude's speed field and combines its Fast and US premiums", () => {
		const metrics = extractTranscriptUsageMetrics(
			claudeTranscript("claude-opus-5", {
				service_tier: "priority",
				speed: "fast",
				inference_geo: "us",
			}),
			undefined,
		);
		expect(metrics.estimatedCost).toBe(1.65);
		expect(metrics.usageEvents[0]).toMatchObject({
			serviceTier: "priority",
			inferenceSpeed: "fast",
			inferenceGeo: "us",
		});
		// Anthropic Priority alone is not OpenAI Fast and must not double the price.
		expect(
			extractTranscriptUsageMetrics(
				claudeTranscript("claude-opus-5", {
					service_tier: "priority",
					speed: "standard",
					inference_geo: "not_available",
				}),
				undefined,
			).estimatedCost,
		).toBe(0.75);
	});

	test("does not invent a Fast price for Fable 5.1", () => {
		expect(
			extractTranscriptUsageMetrics(
				claudeTranscript("claude-fable-5-1", {
					speed: "fast",
				}),
				undefined,
			).estimatedCost,
		).toBeUndefined();
		expect(
			extractTranscriptUsageMetrics(
				claudeTranscript("claude-fable-5-1", {
					inference_geo: "us",
				}),
				undefined,
			).estimatedCost,
		).toBe(1.65);
	});
});
