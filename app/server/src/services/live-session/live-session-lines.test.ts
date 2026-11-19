import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	LIVE_SESSION_MAX_LINE_BYTES,
	LIVE_SESSION_MAX_REQUEST_LINE_BYTES,
	LIVE_SESSION_MAX_REQUEST_LINES,
	LIVE_SESSION_PROTOCOL,
	type LiveSessionAppendInput,
} from "@rudel/api-routes";
import {
	assertStorableText,
	buildLiveSessionChunkObjectKey,
	decodeLiveSessionChunk,
	encodeLiveSessionChunk,
	filterLiveSessionLine,
	LiveSessionAppendValidationError,
	sha256Line,
	validateLiveSessionAppend,
} from "./live-session-lines.js";

function appendInput(
	streams: LiveSessionAppendInput["streams"],
): LiveSessionAppendInput {
	return {
		organizationId: "org-1",
		projectPath: "/repo",
		protocol: LIVE_SESSION_PROTOCOL,
		sessionId: "session-1",
		source: "claude_code",
		streams,
	};
}

function stream(
	lines: string[],
	overrides: Partial<LiveSessionAppendInput["streams"][number]> = {},
): LiveSessionAppendInput["streams"][number] {
	return {
		agentId: null,
		lines,
		previousLineSha256: null,
		startLine: 0,
		...overrides,
	};
}

describe("validateLiveSessionAppend", () => {
	test("refuses a stream named twice", () => {
		expect(() =>
			validateLiveSessionAppend(
				appendInput([
					stream(["a"], { agentId: "sub" }),
					stream(["b"], { agentId: "sub", startLine: 1 }),
				]),
			),
		).toThrow(LiveSessionAppendValidationError);
	});

	test("refuses a reset that does not start the stream over", () => {
		expect(
			validateLiveSessionAppend(
				appendInput([
					stream(["€"], { previousLineSha256: "0".repeat(64), startLine: 3 }),
					stream([], { agentId: "agent-a", reset: true }),
				]),
			),
		).toEqual({ chargeBytes: 3 + 256 });
		expect(() =>
			validateLiveSessionAppend(
				appendInput([stream(["a"], { reset: true, startLine: 3 })]),
			),
		).toThrow("A reset must start at line 0 without a previous line");
		expect(() =>
			validateLiveSessionAppend(
				appendInput([
					stream(["a"], { previousLineSha256: "0".repeat(64), reset: true }),
				]),
			),
		).toThrow("A reset must start at line 0 without a previous line");
	});

	test("refuses a line with a newline", () => {
		expect(() =>
			validateLiveSessionAppend(appendInput([stream(['{"a":1}\n{"b":2}'])])),
		).toThrow("Lines must not contain a newline");
	});

	test("accepts a line of exactly the line limit and refuses one byte more", () => {
		const atLimit = "a".repeat(LIVE_SESSION_MAX_LINE_BYTES);
		expect(validateLiveSessionAppend(appendInput([stream([atLimit])]))).toEqual(
			{ chargeBytes: LIVE_SESSION_MAX_LINE_BYTES + 256 },
		);
		expect(() =>
			validateLiveSessionAppend(appendInput([stream([`${atLimit}a`])])),
		).toThrow(`A line exceeds ${LIVE_SESSION_MAX_LINE_BYTES} bytes`);
	});

	test("refuses more lines than a request may carry across its streams", () => {
		const lines = Array.from(
			{ length: LIVE_SESSION_MAX_REQUEST_LINES / 2 },
			() => "",
		);
		expect(
			validateLiveSessionAppend(
				appendInput([stream(lines), stream(lines, { agentId: "x" })]),
			),
		).toEqual({ chargeBytes: LIVE_SESSION_MAX_REQUEST_LINES * 256 });
		expect(() =>
			validateLiveSessionAppend(
				appendInput([
					stream(lines),
					stream(lines, { agentId: "x" }),
					stream([""], { agentId: "y" }),
				]),
			),
		).toThrow(
			`The request carries more than ${LIVE_SESSION_MAX_REQUEST_LINES} lines`,
		);
	});

	test("refuses NUL in the text stored in Postgres", () => {
		for (const field of ["projectPath", "gitRemote", "gitBranch"] as const) {
			expect(() =>
				validateLiveSessionAppend({
					...appendInput([]),
					[field]: "a\u0000b",
				}),
			).toThrow("Text fields must not contain NUL characters");
		}
		expect(() => assertStorableText({ organizationId: "org\u0000" })).toThrow(
			"Text fields must not contain NUL characters",
		);
	});

	test("refuses a request whose lines exceed the request limit together", () => {
		const half = "a".repeat(LIVE_SESSION_MAX_REQUEST_LINE_BYTES / 2);
		expect(
			validateLiveSessionAppend(appendInput([stream([half, half])])),
		).toEqual({ chargeBytes: LIVE_SESSION_MAX_REQUEST_LINE_BYTES + 2 * 256 });
		expect(() =>
			validateLiveSessionAppend(
				appendInput([stream([half, half]), stream(["a"], { agentId: "x" })]),
			),
		).toThrow(
			`The request's lines exceed ${LIVE_SESSION_MAX_REQUEST_LINE_BYTES} bytes`,
		);
	});
});

describe("sha256Line", () => {
	test("hashes the UTF-8 bytes of the line as sent", () => {
		expect(sha256Line("é")).toBe(
			createHash("sha256")
				.update(Buffer.from([0xc3, 0xa9]))
				.digest("hex"),
		);
	});
});

describe("filterLiveSessionLine", () => {
	test("slims inline images before filtering", () => {
		const pixels = Buffer.alloc(64, 7).toString("base64");
		const line = JSON.stringify({
			type: "user",
			message: {
				role: "user",
				content: [
					{
						type: "image",
						source: { type: "base64", data: pixels, media_type: "image/png" },
					},
				],
			},
		});
		const filtered = filterLiveSessionLine(line);
		expect(filtered).not.toContain(pixels);
		expect(filtered).toContain("opaline-image-omitted:v1;");
	});
});

describe("live session chunks", () => {
	test("store each line terminated by a newline and read them back", () => {
		const bytes = encodeLiveSessionChunk(['{"a":1}', "é"]);
		expect(new TextDecoder().decode(bytes)).toBe('{"a":1}\né\n');
		expect(decodeLiveSessionChunk(bytes, 2)).toEqual(['{"a":1}', "é"]);
	});

	test("refuse an object that does not hold the committed line count", () => {
		expect(() =>
			decodeLiveSessionChunk(encodeLiveSessionChunk(["a", "b"]), 3),
		).toThrow("Live session chunk holds 2 lines; 3 were committed");
		expect(() => decodeLiveSessionChunk(new Uint8Array(), 1)).toThrow(
			"Live session chunk holds 0 lines; 1 were committed",
		);
	});

	test("live under hashed ids, per source, stream and generation, by zero-padded start line and content", () => {
		const hash = (value: string | Uint8Array) =>
			createHash("sha256").update(value).digest("hex");
		const body = encodeLiveSessionChunk(["a"]);
		const content = hash(body).slice(0, 32);
		expect(
			buildLiveSessionChunkObjectKey({
				agentId: null,
				body,
				generation: 0,
				organizationId: "org-1",
				sessionId: "session-1",
				source: "claude_code",
				startLine: 42,
			}),
		).toBe(
			`live/v1/${hash("org-1")}/claude_code/${hash("session-1")}/main/g0/0000000042-${content}.jsonl`,
		);
		expect(
			buildLiveSessionChunkObjectKey({
				agentId: "main",
				body,
				generation: 3,
				organizationId: "org-1",
				sessionId: "session-1",
				source: "codex",
				startLine: 0,
			}),
		).toBe(
			`live/v1/${hash("org-1")}/codex/${hash("session-1")}/agent-main/g3/0000000000-${content}.jsonl`,
		);
	});
});
