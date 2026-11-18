import { describe, expect, test } from "bun:test";
import {
	decodeTranscriptLine,
	splitSessionTranscript,
	splitTranscript,
} from "./split-transcript.js";
import type { TranscriptRecordDraft, TranscriptSource } from "./types.js";

/**
 * Parser 12: every record carries its line's own id (Claude Code `uuid`) as
 * `recordUuid`, so a record can be found by the id an agent copied from the
 * raw transcript. Only the line's own id: never its parent, logical parent or
 * source tool assistant.
 */

const fixture = (name: string) =>
	Bun.file(new URL(`../__fixtures__/${name}`, import.meta.url)).text();

const split = (content: string, source: TranscriptSource = "claude_code") => [
	...splitSessionTranscript({
		content,
		sessionDate: "2026-10-01T09:00:00.000Z",
		source,
	}),
];

const ids = (drafts: readonly TranscriptRecordDraft[]) =>
	drafts.map(
		(draft) =>
			`${draft.recordIdx}.${draft.blockIdx} ${draft.kind} ${draft.recordUuid || "-"}`,
	);

describe("record uuid", () => {
	test("every record of a Claude Code line carries the line's own uuid, never a parent's", async () => {
		expect(
			ids(split(await fixture("l1-facts/claude-record-ids.jsonl"))),
		).toEqual([
			"1.0 user_prompt 0c5f2b9e-3d41-4a8f-b6e2-7f9d1c3a5e01",
			// One line, two blocks: both carry it.
			"2.0 assistant_text 0c5f2b9e-3d41-4a8f-b6e2-7f9d1c3a5e02",
			"2.1 tool_call 0c5f2b9e-3d41-4a8f-b6e2-7f9d1c3a5e02",
			// Its parentUuid and sourceToolAssistantUUID name line 2.
			"3.0 tool_result 0c5f2b9e-3d41-4a8f-b6e2-7f9d1c3a5e03",
			"4.0 user_prompt -",
		]);
	});

	test("Codex lines carry none, though their payloads hold item and call ids", async () => {
		const drafts = split(await fixture("l1-facts/codex-0.156.jsonl"), "codex");
		expect(drafts.length).toBeGreaterThan(5);
		expect(drafts.filter((draft) => draft.recordUuid !== "")).toEqual([]);
	});

	test("unparseable and oversized lines, ids that are not strings and overlong ids carry none", () => {
		const line = (record: Record<string, unknown>) =>
			JSON.stringify({
				type: "user",
				timestamp: "2026-10-01T10:00:00.000Z",
				message: { role: "user", content: "hello" },
				...record,
			});
		const drafts = [
			...splitTranscript({
				content: [
					line({ uuid: "aaaaaaaa-0000-4000-8000-000000000001" }),
					"{not json",
					line({ uuid: 42 }),
					line({ uuid: "x".repeat(65) }),
					line({
						uuid: "aaaaaaaa-0000-4000-8000-000000000005",
						pad: "y".repeat(400),
					}),
				].join("\n"),
				fallbackTs: "2026-10-01T09:00:00.000Z",
				maxParseLineBytes: 300,
				source: "claude_code",
			}),
		];
		expect(ids(drafts)).toEqual([
			"1.0 user_prompt aaaaaaaa-0000-4000-8000-000000000001",
			"2.0 meta -",
			"3.0 user_prompt -",
			"4.0 user_prompt -",
			"5.0 oversized -",
		]);
	});

	test("a line decoded again from its raw bytes keeps its uuid", () => {
		const [draft] = decodeTranscriptLine({
			agentId: "",
			line: JSON.stringify({
				type: "assistant",
				uuid: "aaaaaaaa-0000-4000-8000-0000000000aa",
				parentUuid: "aaaaaaaa-0000-4000-8000-0000000000bb",
				message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
			}),
			source: "claude_code",
		});
		expect(draft?.recordUuid).toBe("aaaaaaaa-0000-4000-8000-0000000000aa");
	});
});
