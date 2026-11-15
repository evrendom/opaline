import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	SESSION_DETAIL_WINDOW_MAX_TURN_BYTES,
	SessionDetailBodyChunkInputSchema,
	SessionDetailInitialSchema,
	SessionDetailTurnSchema,
	SessionDetailWindowSchema,
	type SessionFileChanges,
} from "@rudel/api-routes";
import { API_RESPONSE_MAX_BYTES } from "../lib/api-response-size.js";
import {
	createSessionDetailBodyChunk,
	getSessionDetailBodyForChunk,
	serializeSessionDetailBody,
	serializeSessionDetailBodyForChunk,
} from "../services/session-detail-body-chunks.js";
import {
	assembleSessionDetailWindow,
	deriveSessionDetail,
	type SessionDetailRawSnapshot,
} from "../services/session-detail-derivation.service.js";
import { buildSessionDetailInitial } from "../services/session-detail-initial.js";

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

describe("a session's file changes", () => {
	const changes: SessionFileChanges = {
		files: Array.from({ length: 3_000 }, (_, index) => ({
			changes: [],
			content: `export const value${index} = "${"x".repeat(1_500)}";\n`,
			contentCut: false,
			movedTo: null,
			path: `/repo/src/file-${index}.ts`,
			readBy: [{ agentId: "", turnId: "t1" }],
			readTurns: ["t1"],
			reads: 1,
		})),
		runs: [],
	};

	test("too big for one response, they arrive whole in chunks that each fit", () => {
		const body = serializeSessionDetailBody(changes);
		expect(body.json.length).toBeGreaterThan(API_RESPONSE_MAX_BYTES);
		const input = {
			kind: "fileChanges",
			revision: "7",
			sessionId: "s",
			targetId: "s",
		} as const;
		expect(
			SessionDetailBodyChunkInputSchema.parse(input).kind,
		).toBe("fileChanges");
		expect(getSessionDetailBodyForChunk(derivation, input)).toBeNull();
		const parts: string[] = [];
		for (let offset = 0; offset < body.json.length; ) {
			const chunk = createSessionDetailBodyChunk(body, { ...input, offset });
			expect(
				Buffer.byteLength(JSON.stringify({ json: chunk }), "utf8"),
			).toBeLessThan(API_RESPONSE_MAX_BYTES);
			parts.push(chunk.data);
			offset += chunk.data.length;
		}
		expect(parts.length).toBeGreaterThan(1);
		expect(JSON.parse(parts.join(""))).toEqual(changes);
	});
});

function oversizedSnapshot(): SessionDetailRawSnapshot {
	const turn = (id: string, second: number, user: string, reply: string) => [
		line({
			message: { content: user, role: "user" },
			sessionId: "session-1",
			timestamp: at(second),
			type: "user",
			uuid: id,
		}),
		line({
			message: {
				content: [{ text: reply, type: "text" }],
				id: `message-${id}`,
				model: "claude-opus-5",
				role: "assistant",
			},
			sessionId: "session-1",
			timestamp: at(second + 1),
			type: "assistant",
			uuid: `reply-${id}`,
		}),
	];
	return {
		content: [
			...turn("small", 0, "Hello", "Hi"),
			...turn(
				"large-reply",
				10,
				"Dump the log",
				"🙂 log line\n".repeat(SESSION_DETAIL_WINDOW_MAX_TURN_BYTES / 8),
			),
			...turn(
				"large-prompt",
				20,
				"x".repeat(SESSION_DETAIL_WINDOW_MAX_TURN_BYTES + 1),
				"Read it",
			),
		].join("\n"),
		durationMinutes: 1,
		gitBranch: "main",
		gitRemote: "github.com/rudel/rudel",
		gitSha: "abc",
		inputTokens: 0,
		lastInteractionDate: at(30),
		modelUsed: "claude-opus-5",
		organizationId: "org-1",
		outputTokens: 0,
		ownerId: "owner-1",
		packageName: "rudel",
		projectPath: "/src/rudel",
		revision: "11",
		sessionDate: at(0),
		sessionId: "session-1",
		skills: [],
		slashCommands: [],
		source: "claude_code",
		subagents: {},
		totalTokens: 0,
	};
}

describe("oversized bodies in a window", () => {
	const derivation = deriveSessionDetail(oversizedSnapshot());

	test("carry the chunk total and checksum the chunk endpoint serves", () => {
		const window = SessionDetailWindowSchema.parse(
			assembleSessionDetailWindow({
				derivation,
				request: {
					anchorTurnId: "small",
					bodyChunks: true,
					includeBodies: true,
					mode: "anchor",
					revision: "11",
					sessionId: "session-1",
				},
			}).window,
		);
		const byId = new Map(window.turns.map((turn) => [turn.turnId, turn]));
		expect(byId.get("small")?.bodyOmitted).toBeNull();
		expect(byId.get("small")?.bodyChunks).toBeUndefined();
		for (const turnId of ["large-reply", "large-prompt"]) {
			const turn = byId.get(turnId);
			expect(turn?.bodyOmitted).toBe("oversized");
			const serialized = serializeSessionDetailBodyForChunk(derivation, {
				kind: "turn",
				targetId: turnId,
			});
			if (!serialized || !turn?.bodyChunks)
				throw new Error(`Expected ${turnId} to be chunked`);
			expect(serialized.json.length).toBeGreaterThan(
				SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
			);
			expect(turn.bodyChunks).toEqual({
				sha256: createHash("sha256").update(serialized.json).digest("hex"),
				totalCodeUnits: serialized.json.length,
			});
			const last = createSessionDetailBodyChunk(serialized, {
				kind: "turn",
				offset:
					Math.floor(
						(serialized.json.length - 1) / SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
					) * SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
				revision: "11",
				sessionId: "session-1",
				targetId: turnId,
			});
			expect(last.sha256).toBe(turn.bodyChunks.sha256);
			expect(last.totalCodeUnits).toBe(turn.bodyChunks.totalCodeUnits);
			expect(
				SessionDetailTurnSchema.parse(JSON.parse(serialized.json)),
			).toEqual(
				SessionDetailTurnSchema.parse(derivation.turnBodies.get(turnId)),
			);
		}
	});

	test("carry it in the initial window too", () => {
		const initial = SessionDetailInitialSchema.parse(
			buildSessionDetailInitial(derivation, { bodyChunks: true }),
		);
		const large = initial.window.turns.find(
			(turn) => turn.turnId === "large-reply",
		);
		expect(large?.bodyOmitted).toBe("oversized");
		expect(large?.bodyChunks?.totalCodeUnits).toBeGreaterThan(
			SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
		);
	});

	test("stay out of windows and initial views that did not ask for them", () => {
		const window = assembleSessionDetailWindow({
			derivation,
			request: {
				anchorTurnId: "small",
				includeBodies: true,
				mode: "anchor",
				revision: "11",
				sessionId: "session-1",
			},
		}).window;
		const initial = buildSessionDetailInitial(derivation);
		for (const turns of [window.turns, initial.window.turns]) {
			const oversized = turns.filter(
				(turn) => turn.bodyOmitted === "oversized",
			);
			expect(oversized.map((turn) => turn.turnId)).toContain("large-reply");
			for (const turn of oversized) expect("bodyChunks" in turn).toBe(false);
		}
	});

	test("a body store without chunk totals still omits the body", () => {
		const window = assembleSessionDetailWindow({
			derivation: { ...derivation, turnBodies: new Map(derivation.turnBodies) },
			request: {
				anchorTurnId: "large-reply",
				bodyChunks: true,
				includeBodies: true,
				mode: "anchor",
				revision: "11",
				sessionId: "session-1",
			},
		}).window;
		const large = window.turns.find((turn) => turn.turnId === "large-reply");
		expect(large?.bodyOmitted).toBe("oversized");
		expect(large && "bodyChunks" in large).toBe(false);
	});
});
