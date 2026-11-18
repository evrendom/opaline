import { describe, expect, test } from "bun:test";
import { parseCodexConversations } from "../session-transcript/codex-conversation-parser.js";
import { extractTranscriptUsageMetrics } from "../session-transcript/session-turn-metadata.js";
import { splitSessionTranscript } from "../session-transcript/transcript-records/split-transcript.js";

// A Codex fork file holds its OWN session_meta first, then a replayed copy of
// the parent's session_meta whose payload.id equals the fork's forked_from_id.
function forkTranscript(...rest: Record<string, unknown>[]) {
	return [
		{
			type: "session_meta",
			timestamp: "2026-09-12T12:00:00.000Z",
			payload: {
				id: "fork-session",
				forked_from_id: "parent-session",
				model_provider: "openai",
			},
		},
		{
			type: "session_meta",
			timestamp: "2026-09-12T12:00:00.010Z",
			payload: { id: "parent-session", model_provider: "parent-provider" },
		},
		...rest,
	]
		.map((entry) => JSON.stringify(entry))
		.join("\n");
}

describe("Codex fork files", () => {
	test("the conversation parser names the fork by its own session_meta", () => {
		const entries = parseCodexConversations(
			forkTranscript({
				type: "event_msg",
				timestamp: "2026-09-12T12:00:05.000Z",
				payload: { type: "context_compacted" },
			}),
		);
		const sessionIds = entries.flatMap((entry) =>
			"sessionId" in entry ? [entry.sessionId] : [],
		);
		expect(sessionIds.length).toBeGreaterThan(0);
		expect(new Set(sessionIds)).toEqual(new Set(["fork-session"]));
	});

	test("the first session_meta supplies the model provider of every request", () => {
		const metrics = extractTranscriptUsageMetrics(
			forkTranscript(
				{ type: "turn_context", payload: { model: "gpt-6-astra" } },
				{
					type: "event_msg",
					timestamp: "2026-09-12T12:00:05.000Z",
					payload: {
						type: "token_count",
						info: {
							last_token_usage: { input_tokens: 1000, output_tokens: 100 },
							total_token_usage: { input_tokens: 1000, output_tokens: 100 },
						},
					},
				},
			),
			undefined,
		);
		expect(metrics.usageEvents).toHaveLength(1);
		expect(metrics.usageEvents[0]?.modelProvider).toBe("openai");
	});

	test("a replayed parent session_meta does not replace the fork point", () => {
		const content = [
			{
				type: "session_meta",
				payload: {
					id: "child",
					forked_from_id: "parent",
					forked_from_ordinal_exclusive: 4,
				},
			},
			{
				type: "session_meta",
				payload: {
					id: "parent",
					forked_from_id: "grandparent",
					forked_from_ordinal_exclusive: 1,
				},
			},
			...[2, 3, 4].map((ordinal) => ({
				ordinal,
				type: "response_item",
				payload: {
					type: "function_call",
					name: "exec_command",
					call_id: `call-${ordinal}`,
					arguments: JSON.stringify({ cmd: "true" }),
				},
			})),
		]
			.map((entry) =>
				JSON.stringify({ timestamp: "2026-09-12T12:00:00.000Z", ...entry }),
			)
			.join("\n");
		const replayed = new Set(
			[
				...splitSessionTranscript({
					source: "codex",
					content,
					sessionDate: "2026-09-12T12:00:00.000Z",
				}),
			]
				.filter(
					(row) =>
						row.callId !== "" && row.facts.extra.fork_replayed === "true",
				)
				.map((row) => row.callId),
		);
		// Ordinals 2 and 3 precede the child's own fork point (4), not the parent's (1).
		expect(replayed).toEqual(new Set(["call-2", "call-3"]));
	});
});
