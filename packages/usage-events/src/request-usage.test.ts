import { expect, test } from "bun:test";
import { extractUsageEvents } from "./extract.js";

function extract(lines: readonly unknown[]) {
	return extractUsageEvents({
		organizationId: "org",
		userId: "user",
		sessionId: "session",
		source: "codex",
		subagents: {},
		content: lines.map((line) => JSON.stringify(line)).join("\n"),
	});
}

test("Claude final thinking tokens and recorded cache TTLs are not inferred", () => {
	const line = (output: number, thinking: number) => ({
		type: "assistant",
		timestamp: "2026-10-09T09:00:00Z",
		message: {
			id: "response",
			model: "claude-sonnet-4-5",
			usage: {
				input_tokens: 10,
				output_tokens: output,
				cache_creation_input_tokens: 4,
				output_tokens_details: { thinking_tokens: thinking },
			},
			content: [],
		},
	});
	const result = extractUsageEvents({
		organizationId: "org",
		userId: "user",
		sessionId: "session",
		source: "claude_code",
		subagents: {},
		content: [line(8, 6), line(3, 2)]
			.map((value) => JSON.stringify(value))
			.join("\n"),
	});
	const event = result.events[0];
	expect(result.status).toBe("complete");
	expect(event).toMatchObject({
		outputTokens: 3,
		reasoningOutputTokens: 2,
		cacheWriteInputTokens: 4,
		recordedCacheWrite5mInputTokens: null,
		recordedCacheWrite1hInputTokens: null,
	});
});

test("configured Codex tier is explicitly marked on both usage formats", () => {
	const context = {
		type: "turn_context",
		payload: { model: "gpt-5.4", service_tier: "priority" },
	};
	const modern = extract([context, request("tiered", 12, 5)]);
	expect(modern.events[0]?.serviceTier).toBe("priority");
	expect(modern.events[0]?.qualityFlags).toContain("service_tier_configured");
	const legacy = extract([
		context,
		{
			type: "event_msg",
			timestamp: "2026-10-09T09:00:00Z",
			payload: {
				type: "token_count",
				info: {
					total_token_usage: {
						input_tokens: 12,
						cached_input_tokens: 2,
						output_tokens: 5,
						reasoning_output_tokens: 1,
					},
					last_token_usage: {
						input_tokens: 12,
						cached_input_tokens: 2,
						output_tokens: 5,
						reasoning_output_tokens: 1,
					},
				},
			},
		},
	]);
	expect(legacy.events[0]?.serviceTier).toBe("priority");
	expect(legacy.events[0]?.qualityFlags).toContain("service_tier_configured");
});

function request(
	responseId: string,
	inputTokens: number,
	outputTokens: number,
	ordinal = 12,
) {
	return {
		type: "token_usage_record",
		timestamp: "2026-10-09T09:00:00Z",
		ordinal,
		payload: {
			response_id: responseId,
			thread_id: "thread",
			turn_id: "turn",
			root_turn_id: "root",
			usage: {
				input_tokens: inputTokens,
				cached_input_tokens: 2,
				output_tokens: outputTokens,
				reasoning_output_tokens: 1,
				cache_write_input_tokens: 3,
				total_tokens: inputTokens + outputTokens,
			},
			turn_token_usage: { input_tokens: 100_000 },
			thread_token_usage: { input_tokens: 200_000 },
		},
	};
}

function legacyUsage(
	inputTokens: number,
	outputTokens: number,
	totalInput = inputTokens,
	totalOutput = outputTokens,
	totalCache = 2,
	totalReasoning = 1,
	ordinal = 12,
) {
	return {
		type: "event_msg",
		timestamp: "2026-10-09T09:00:00Z",
		ordinal,
		payload: {
			type: "token_count",
			info: {
				last_token_usage: {
					input_tokens: inputTokens,
					cached_input_tokens: 2,
					output_tokens: outputTokens,
					reasoning_output_tokens: 1,
				},
				total_token_usage: {
					input_tokens: totalInput,
					cached_input_tokens: totalCache,
					output_tokens: totalOutput,
					reasoning_output_tokens: totalReasoning,
				},
			},
		},
	};
}

test("mixed request formats retain legacy increments before and after new records", () => {
	const result = extract([
		{ type: "turn_context", payload: { model: "gpt-5.4" } },
		legacyUsage(10, 3),
		request("modern", 12, 5),
		legacyUsage(5, 2, 27, 10, 6, 3),
	]);
	expect(result.status).toBe("complete");
	expect(result.events).toHaveLength(3);
	expect(result.events.map((event) => event.contextInputTokens)).toEqual([
		10, 12, 5,
	]);
	expect(
		result.events.reduce((total, event) => total + event.outputTokens, 0),
	).toBe(10);
});

test("mixed exact transition mirrors are suppressed once, not unrelated legacy increments", () => {
	const modern = request("modern", 10, 3);
	const witnessed = {
		...modern,
		payload: {
			...modern.payload,
			thread_token_usage: {
				input_tokens: 10,
				cached_input_tokens: 2,
				output_tokens: 3,
				reasoning_output_tokens: 1,
			},
		},
	};
	for (const records of [
		[legacyUsage(10, 3), witnessed],
		[witnessed, legacyUsage(10, 3)],
	]) {
		const result = extract([
			{ type: "turn_context", payload: { model: "gpt-5.4" } },
			...records,
			legacyUsage(10, 3, 20, 6, 4, 2),
		]);
		expect(result.status).toBe("complete");
		expect(result.events).toHaveLength(2);
		expect(result.events.map((event) => event.contextInputTokens)).toEqual([
			10, 10,
		]);
		expect(
			result.events.filter((event) => event.identityKind === "response_id"),
		).toHaveLength(1);
		expect(
			result.diagnostics.some(
				(diagnostic) => diagnostic.code === "codex_request_usage_mirror",
			),
		).toBe(true);
	}
});

test("legacy usage in forks respects the same own-history boundary", () => {
	const result = extract([
		{
			type: "session_meta",
			payload: {
				id: "child",
				forked_from_id: "parent",
				subagent_history_start_ordinal: 12,
			},
		},
		{ type: "turn_context", payload: { model: "gpt-5.4" } },
		legacyUsage(10, 3, 10, 3, 2, 1, 11),
		legacyUsage(12, 5, 22, 8, 4, 2, 12),
	]);
	expect(result.events).toHaveLength(1);
	expect(result.events[0]?.contextInputTokens).toBe(12);
});

test("request usage is keyed by response id, keeps the last snapshot, and never adds aggregate witnesses", () => {
	const result = extract([
		{
			type: "session_meta",
			payload: { id: "thread", model_provider: "openai" },
		},
		{ type: "turn_context", payload: { model: "gpt-5.4" } },
		request("response-1", 10, 7),
		request("response-1", 8, 3),
		request("response-2", 12, 5),
		{
			type: "event_msg",
			payload: {
				type: "token_count",
				info: {
					total_token_usage: {
						input_tokens: 999,
						cached_input_tokens: 0,
						output_tokens: 999,
						reasoning_output_tokens: 0,
					},
				},
			},
		},
	]);
	expect(result.status).toBe("complete");
	expect(result.events).toHaveLength(2);
	expect(
		result.events.every((event) => event.identityKind === "response_id"),
	).toBe(true);
	expect(
		result.events
			.map((event) => event.contextInputTokens)
			.sort((left, right) => left - right),
	).toEqual([8, 12]);
	expect(
		result.events.every(
			(event) =>
				event.cacheWrite5mInputTokens === null &&
				event.cacheWrite1hInputTokens === null,
		),
	).toBe(true);
	expect(
		result.events.every((event) => event.cacheWriteInputTokens === 3),
	).toBe(true);
	expect(
		result.events.some((event) => event.duplicateObservationCount === 1),
	).toBe(true);
});

test("request fork replay uses recorded ordinals, never timestamp proximity", () => {
	const result = extract([
		{
			type: "session_meta",
			payload: {
				id: "child",
				forked_from_id: "parent",
				subagent_history_start_ordinal: 12,
			},
		},
		request("inherited", 10, 7, 11),
		request("new", 12, 5, 12),
	]);
	expect(result.status).toBe("complete");
	expect(result.events).toHaveLength(1);
	expect(result.events[0]?.contextInputTokens).toBe(12);
	expect(result.diagnostics).toContainEqual({
		code: "codex_replayed_request_usage",
		count: 1,
		fatal: false,
	});
});

test("request usage of a fork keeps the provider of its own session_meta", () => {
	const result = extract([
		{
			type: "session_meta",
			payload: {
				id: "child",
				forked_from_id: "parent",
				forked_from_ordinal_exclusive: 12,
				model_provider: "openai",
			},
		},
		{
			type: "session_meta",
			payload: { id: "parent", model_provider: "other-provider" },
		},
		{ type: "turn_context", payload: { model: "gpt-5.4" } },
		request("new", 12, 5, 12),
	]);
	expect(result.events).toHaveLength(1);
	expect(result.events[0]?.modelProvider).toBe("openai");
});

test("unrecorded cache writes stay null rather than being manufactured as zero", () => {
	const result = extract([
		{
			type: "event_msg",
			timestamp: "2026-10-09T09:00:00Z",
			payload: {
				type: "token_count",
				info: {
					total_token_usage: {
						input_tokens: 10,
						cached_input_tokens: 2,
						output_tokens: 3,
						reasoning_output_tokens: 1,
					},
					last_token_usage: {
						input_tokens: 10,
						cached_input_tokens: 2,
						output_tokens: 3,
						reasoning_output_tokens: 1,
					},
				},
			},
		},
	]);
	expect(result.status).toBe("complete");
	expect(result.events).toHaveLength(1);
	expect(result.events[0]?.cacheWrite5mInputTokens).toBeNull();
	expect(result.events[0]?.cacheWrite1hInputTokens).toBeNull();
	expect(result.events[0]?.cacheWriteInputTokens).toBeNull();
});

test("explicit unknown cache writes and cleared tiers do not retain invented values", () => {
	const response = request("unknown-write", 10, 3);
	const result = extract([
		{ type: "turn_context", payload: { service_tier: "priority" } },
		{
			type: "event_msg",
			payload: {
				type: "thread_settings_applied",
				thread_settings: { service_tier: null },
			},
		},
		{
			...response,
			payload: {
				...response.payload,
				usage: { ...response.payload.usage, cache_write_input_tokens: null },
			},
		},
	]);
	expect(result.status).toBe("complete");
	expect(result.events[0]?.cacheWriteInputTokens).toBeNull();
	expect(result.events[0]?.serviceTier).toBe("");
	expect(result.events[0]?.qualityFlags).toContain("service_tier_configured");
});

test("a recorded response tier wins over the configured one and carries no configured price basis", () => {
	const usage = {
		input_tokens: 12,
		cached_input_tokens: 2,
		output_tokens: 5,
		reasoning_output_tokens: 1,
	};
	const tokenCount = (info: Record<string, unknown>) => ({
		type: "event_msg",
		timestamp: "2026-10-09T09:00:00Z",
		payload: {
			type: "token_count",
			info: { total_token_usage: usage, last_token_usage: usage, ...info },
		},
	});
	const context = {
		type: "turn_context",
		payload: { model: "gpt-5.4", service_tier: "priority" },
	};
	const recorded = extract([context, tokenCount({ service_tier: "default" })]);
	expect(recorded.events[0]?.serviceTier).toBe("default");
	expect(recorded.events[0]?.qualityFlags).not.toContain(
		"service_tier_configured",
	);
	// With no recorded tier the configured one is stored literally and labelled,
	// which is the price basis analysis uses.
	const configured = extract([context, tokenCount({})]);
	expect(configured.events[0]?.serviceTier).toBe("priority");
	expect(configured.events[0]?.qualityFlags).toContain(
		"service_tier_configured",
	);
});
