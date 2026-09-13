import { expect, test } from "bun:test";
import {
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	type SessionDetailBodyChunkInput,
	SessionDetailBodyChunkSchema,
	SessionDetailSubagentSchema,
	SessionDetailTurnSchema,
} from "@rudel/api-routes";
import {
	createSessionDetailBodyChunk,
	getSessionDetailBodyForChunk,
	serializeSessionDetailBody,
} from "../../../../../api/src/services/session-detail-body-chunks";
import {
	readSessionDetailBodyChunks,
	SessionDetailBodyIntegrityError,
} from "./session-detail-body-chunks";

const identity: Omit<SessionDetailBodyChunkInput, "offset"> = {
	kind: "turn",
	targetId: "turn-1",
	revision: "18446744073709551615",
	sessionId: "session-1",
};

test("chunk selection reads complete derived bodies and distinguishes missing targets", () => {
	const turn = SessionDetailTurnSchema.parse({
		revision: identity.revision,
		turnId: identity.targetId,
		userItems: [],
		responseItems: [
			{ id: "large", kind: "summary", text: "x".repeat(1_600_000) },
		],
	});
	const content = "raw\n".repeat(400_000);
	const derivation = {
		revision: identity.revision,
		rawSubagents: { agent: content, empty: "" },
		turnBodies: new Map([[turn.turnId, turn]]),
	};
	expect(getSessionDetailBodyForChunk(derivation, identity)).toBe(turn);
	expect(
		getSessionDetailBodyForChunk(derivation, {
			kind: "subagent",
			targetId: "agent",
		}),
	).toEqual({ content, revision: identity.revision, subagentId: "agent" });
	expect(
		getSessionDetailBodyForChunk(derivation, {
			kind: "subagent",
			targetId: "empty",
		}),
	).toEqual({ content: "", revision: identity.revision, subagentId: "empty" });
	for (const kind of ["turn", "subagent"] as const) {
		expect(
			getSessionDetailBodyForChunk(derivation, { kind, targetId: "missing" }),
		).toBeNull();
	}
});

test("a multi-megabyte body survives JSON transport verbatim, including Unicode and control characters", async () => {
	const body = SessionDetailTurnSchema.parse({
		revision: identity.revision,
		turnId: identity.targetId,
		userItems: [],
		responseItems: [
			{
				id: "large-result",
				kind: "summary",
				text: '🌍\u0000\n\\"日本語'.repeat(600_000),
			},
		],
	});
	const serialized = serializeSessionDetailBody(body);
	expect(Buffer.byteLength(serialized.json)).toBeGreaterThan(4.5 * 1024 * 1024);
	const offsets: number[] = [];
	const result = await readSessionDetailBodyChunks(
		identity,
		new AbortController().signal,
		{
			request: async (input) => {
				offsets.push(input.offset);
				const chunk = createSessionDetailBodyChunk(serialized, input);
				const wire = JSON.stringify({ json: chunk });
				expect(Buffer.byteLength(wire)).toBeLessThan(2 * 1024 * 1024);
				return SessionDetailBodyChunkSchema.parse(JSON.parse(wire).json);
			},
		},
	);
	expect(result).toEqual(body);
	expect(offsets.length).toBe(
		Math.ceil(serialized.json.length / SESSION_DETAIL_BODY_CHUNK_CODE_UNITS),
	);
	expect(new Set(offsets).size).toBe(offsets.length);
});

test("subagent raw content and a surrogate pair split across chunks are preserved", async () => {
	const prefix = JSON.stringify({ content: "" }).indexOf('""') + 1;
	const body = SessionDetailSubagentSchema.parse({
		content: `${"x".repeat(SESSION_DETAIL_BODY_CHUNK_CODE_UNITS - prefix - 1)}🌍\n{"raw":true}`,
		revision: identity.revision,
		subagentId: "agent-1",
	});
	const serialized = serializeSessionDetailBody(body);
	expect(
		serialized.json.charCodeAt(SESSION_DETAIL_BODY_CHUNK_CODE_UNITS - 1),
	).toBe(0xd83c);
	const result = await readSessionDetailBodyChunks(
		{ ...identity, kind: "subagent", targetId: "agent-1" },
		new AbortController().signal,
		{
			request: async (input) =>
				JSON.parse(
					JSON.stringify(createSessionDetailBodyChunk(serialized, input)),
				),
		},
	);
	expect(result).toEqual(body);
});

test("invalid offsets are rejected instead of silently repeating or truncating a chunk", () => {
	const body = serializeSessionDetailBody({
		content: "raw",
		revision: identity.revision,
		subagentId: "a",
	});
	for (const offset of [
		-1,
		0.5,
		1,
		SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		expect(() =>
			createSessionDetailBodyChunk(body, { ...identity, offset }),
		).toThrow(RangeError);
	}
});

test("reassembly rejects changed identities, missing data, offsets, lengths and checksums", async () => {
	const body = serializeSessionDetailBody({
		content: "x".repeat(SESSION_DETAIL_BODY_CHUNK_CODE_UNITS * 2),
		revision: identity.revision,
		subagentId: "a",
	});
	const corruptions = [
		{ sessionId: "another-session" },
		{ targetId: "another-body" },
		{ kind: "subagent" },
		{ revision: "1" },
		{ offset: 0 },
		{ data: "short" },
		{ totalCodeUnits: body.json.length + 1 },
		{ sha256: "0".repeat(64) },
	];
	for (const corruption of corruptions) {
		await expect(
			readSessionDetailBodyChunks(identity, new AbortController().signal, {
				request: async (input) => ({
					...createSessionDetailBodyChunk(body, input),
					...(input.offset > 0 ? corruption : {}),
				}),
			}),
		).rejects.toBeInstanceOf(SessionDetailBodyIntegrityError);
	}
	await expect(
		readSessionDetailBodyChunks(identity, new AbortController().signal, {
			request: async (input) => ({
				...createSessionDetailBodyChunk(body, input),
				sha256: "0".repeat(64),
			}),
		}),
	).rejects.toBeInstanceOf(SessionDetailBodyIntegrityError);
});

test("cancellation stops delivery without returning a partial transcript", async () => {
	const controller = new AbortController();
	const body = serializeSessionDetailBody({
		content: "x".repeat(SESSION_DETAIL_BODY_CHUNK_CODE_UNITS * 2),
		revision: identity.revision,
		subagentId: "a",
	});
	let requests = 0;
	await expect(
		readSessionDetailBodyChunks(identity, controller.signal, {
			request: async (input) => {
				requests++;
				controller.abort(new Error("Navigation cancelled"));
				return createSessionDetailBodyChunk(body, input);
			},
		}),
	).rejects.toThrow("Navigation cancelled");
	expect(requests).toBe(1);
});
