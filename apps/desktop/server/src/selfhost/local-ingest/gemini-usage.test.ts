import { describe, expect, test } from "bun:test";
import { translateGeminiCliSession } from "@rudel/agent-adapters";
import { extractUsageEvents } from "@rudel/usage-events";

const SESSION = "8d1f6a6e-5b0c-4e45-9a0e-1f3f0c7e2b11";

function session(model: string): string {
	return (
		translateGeminiCliSession(
			[
				{
					sessionId: SESSION,
					projectHash: "h",
					startTime: "2026-11-20T10:00:00.000Z",
				},
				{
					id: "u1",
					timestamp: "2026-11-20T10:00:01.000Z",
					type: "user",
					content: "hi",
				},
				{
					id: "g1",
					timestamp: "2026-11-20T10:00:05.000Z",
					type: "gemini",
					content: "hello",
					model,
					tokens: {
						input: 12000,
						output: 300,
						cached: 8000,
						thoughts: 200,
						tool: 0,
						total: 12500,
					},
				},
				// Gemini CLI writes a message again as it fills in; it is one request.
				{
					id: "g1",
					timestamp: "2026-11-20T10:00:05.000Z",
					type: "gemini",
					content: "hello",
					model,
					tokens: {
						input: 12000,
						output: 300,
						cached: 8000,
						thoughts: 200,
						tool: 0,
						total: 12500,
					},
				},
			]
				.map((line) => JSON.stringify(line))
				.join("\n"),
			{ cwd: "/repo" },
		)?.content ?? ""
	);
}

describe("Gemini usage", () => {
	test("a Neon request is one Google-priced event with cached input apart", () => {
		const result = extractUsageEvents({
			organizationId: "org",
			userId: "user",
			sessionId: SESSION,
			source: "gemini",
			content: session("gemini-4-neon"),
			subagents: {},
		});
		expect(result.status).toBe("complete");
		expect(result.events).toHaveLength(1);
		const [event] = result.events;
		expect(event).toMatchObject({
			source: "gemini",
			rawModel: "gemini-4-neon",
			resolvedModel: "gemini-4-neon",
			modelStatus: "resolved",
			uncachedInputTokens: 4000,
			cacheReadInputTokens: 8000,
			outputTokens: 500,
			reasoningOutputTokens: 200,
			contextInputTokens: 12000,
		});
		expect(event?.qualityFlags).not.toContain("provider_model_mismatch");
	});

	test("Antigravity's thinking-level model names resolve to the model", () => {
		const result = extractUsageEvents({
			organizationId: "org",
			userId: "user",
			sessionId: SESSION,
			source: "gemini",
			content: session("gemini-4-neon-xhigh"),
			subagents: {},
		});
		expect(result.events[0]?.resolvedModel).toBe("gemini-4-neon");
	});
});
