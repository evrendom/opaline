import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { formatInlineImageMarker } from "../../inline-image-marker.js";
import {
	assignLineImages,
	readLineImageMarkers,
	TRANSCRIPT_RECORD_IMAGE_FACT_MAX_ENTRIES,
	withImageFacts,
} from "./image-facts.js";
import { splitTranscript } from "./split-transcript.js";

const SHOT = "3b39b023b25be13038559fef0c4177bcb109323b43b949a47088a1a3093b204a";
const PASTED =
	"a9ae077afff9f462f45efe27269a484d5e2f47f1205c3fa46f9a88e086b3faf2";

function marker(sha256: string, bytes = 100, mediaType = "image/png") {
	return { bytes, mediaType, sha256 };
}

describe("image facts", () => {
	test("a tool result's screenshot and a pasted image are listed on their records", () => {
		const content = readFileSync(
			new URL("../__fixtures__/l1-facts/claude-images.jsonl", import.meta.url),
			"utf8",
		);
		const drafts = [
			...splitTranscript({
				agentId: "",
				content,
				fallbackTs: "2026-10-01T12:00:00.000Z",
				source: "claude_code",
			}),
		];
		const withImages = drafts
			.filter((draft) => draft.facts.extra?.images !== undefined)
			.map((draft) => ({
				kind: draft.kind,
				recordIdx: draft.recordIdx,
				callId: draft.callId,
				images: JSON.parse(draft.facts.extra?.images ?? "[]"),
			}));
		expect(withImages).toEqual([
			{
				kind: "user_prompt",
				recordIdx: 1,
				callId: "",
				images: [{ sha256: PASTED, bytes: 48213, type: "image/png" }],
			},
			{
				// The marker is in the content and in toolUseResult: listed once.
				kind: "tool_result",
				recordIdx: 3,
				callId: "toolu_shot",
				images: [{ sha256: SHOT, bytes: 391022, type: "image/png" }],
			},
		]);
	});

	test("reads every distinct marker of a line, inside JSON-encoded strings too", () => {
		const inner = JSON.stringify({
			content: [{ type: "image", data: formatInlineImageMarker(marker(SHOT)) }],
		});
		const line = JSON.stringify({
			a: formatInlineImageMarker(marker(PASTED, 7, "image/jpeg")),
			b: inner,
			c: formatInlineImageMarker(marker(PASTED, 7, "image/jpeg")),
		});
		expect(readLineImageMarkers(line)).toEqual([
			marker(PASTED, 7, "image/jpeg"),
			marker(SHOT),
		]);
		expect(readLineImageMarkers('{"text":"no images here"}')).toEqual([]);
		// A partial or uppercase digest is not a marker.
		expect(
			readLineImageMarkers(
				`opaline-image-omitted:v1;sha256=${"A".repeat(64)};bytes=1;type=image/png`,
			),
		).toEqual([]);
	});

	test("a line's records get the images their text labels, the rest go to the first", () => {
		const shot = marker(SHOT, 2048);
		const pasted = marker(PASTED, 2048);
		expect(
			assignLineImages(
				[
					{ text: "first" },
					{ text: "[screenshot image/png 2.0 KB sha256:3b39b023b25b]" },
				],
				[shot, pasted],
			),
		).toEqual([[pasted], [shot]]);
		expect(assignLineImages([{ text: "only" }], [shot, pasted])).toEqual([
			[shot, pasted],
		]);
		expect(assignLineImages([{}, {}], [])).toEqual([[], []]);
	});

	test("lists at most 64 images per record; images_more counts the rest", () => {
		const images = Array.from(
			{ length: TRANSCRIPT_RECORD_IMAGE_FACT_MAX_ENTRIES + 3 },
			(_, index) => marker(index.toString(16).padStart(64, "0")),
		);
		const facts = withImageFacts(
			{ extra: { facts_clipped: "shell_read_paths" } },
			images,
		);
		expect(JSON.parse(facts?.extra?.images ?? "[]")).toHaveLength(
			TRANSCRIPT_RECORD_IMAGE_FACT_MAX_ENTRIES,
		);
		expect(facts?.extra?.images_more).toBe("3");
		expect(facts?.extra?.facts_clipped).toBe("images,shell_read_paths");
		expect(withImageFacts(undefined, [])).toBeUndefined();
	});
});
