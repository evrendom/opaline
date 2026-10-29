import { describe, expect, test } from "bun:test";
import { SessionDetailBodyChunkInputSchema } from "@rudel/api-routes";
import {
	getSessionDetailBodyForChunk,
	serializeSessionDetailBody,
} from "../services/session-detail-body-chunks.js";

const line = (value: unknown) => JSON.stringify(value);
const base = { parentUuid: null, sessionId: "subagent-session" };
const at = (second: number) =>
	new Date(Date.UTC(2026, 9, 16, 10, 0, second)).toISOString();

const transcript = [
	line({
		...base,
		uuid: "prompt",
		timestamp: at(0),
		type: "user",
		message: { role: "user", content: "Read the config" },
	}),
	line({
		...base,
		uuid: "call",
		timestamp: at(1),
		type: "assistant",
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_read",
					name: "Read",
					input: { file_path: "/repo/config.ts" },
				},
			],
		},
	}),
	line({
		...base,
		uuid: "result",
		timestamp: at(2),
		type: "user",
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "toolu_read",
					content: "export {}",
				},
			],
		},
	}),
	line({
		...base,
		uuid: "answer",
		timestamp: at(3),
		type: "assistant",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "It exports nothing." }],
		},
	}),
].join("\n");

const derivation = {
	rawSubagents: { a417: transcript },
	revision: "7",
	turnBodies: new Map(),
};

describe("session detail body chunks", () => {
	test("a subagent's trace: its steps, read on the server, smaller than its transcript", () => {
		expect(
			SessionDetailBodyChunkInputSchema.parse({
				kind: "subagentTrace",
				revision: "7",
				sessionId: "s",
				targetId: "a417",
			}).kind,
		).toBe("subagentTrace");
		const trace = getSessionDetailBodyForChunk(derivation, {
			kind: "subagentTrace",
			targetId: "a417",
		});
		expect(trace).toMatchObject({ revision: "7", subagentId: "a417" });
		const items = trace && "items" in trace ? trace.items : [];
		const events = items.flatMap((item) =>
			item.kind === "agent" ? item.events : [],
		);
		expect(events.map((event) => event.kind)).toEqual(["tool", "message"]);
		const call = events[0];
		expect(call?.kind === "tool" && call.result?.content).toBe("export {}");
		expect(call && "activity" in call).toBe(false);
		const raw = getSessionDetailBodyForChunk(derivation, {
			kind: "subagent",
			targetId: "a417",
		});
		expect(raw).toMatchObject({ content: transcript });
		expect(
			serializeSessionDetailBody(
				trace ?? { content: "", revision: "7", subagentId: "a417" },
			).json.length,
		).toBeLessThan(transcript.length);
	});

	test("an unknown subagent has neither", () => {
		expect(
			getSessionDetailBodyForChunk(derivation, {
				kind: "subagentTrace",
				targetId: "missing",
			}),
		).toBeNull();
	});
});
