import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
	buildConversationTrace,
	parseConversations,
	readInlineImageMarkerFromSource,
} from "../index.js";
import { slimTranscriptText } from "../transcript-slim.js";

const PIXELS = Buffer.from(
	Array.from({ length: 900 }, (_, index) => index % 251),
);
const PIXELS_BASE64 = PIXELS.toString("base64");
const EXPECTED_MARKER = {
	bytes: 900,
	mediaType: "image/png",
	sha256: createHash("sha256").update(PIXELS).digest("hex"),
};

function toolResultImageSources(content: string) {
	const items = buildConversationTrace(parseConversations(content));
	return items.flatMap((item) =>
		item.kind === "agent"
			? item.events.flatMap((event) =>
					event.kind === "tool" && Array.isArray(event.result?.content)
						? event.result.content.flatMap((block) =>
								block.type === "image" ? [block.source] : [],
							)
						: [],
				)
			: [],
	);
}

describe("session detail for stripped screenshots", () => {
	test("a Claude tool-result screenshot keeps the marker as its image source", () => {
		const content = [
			JSON.stringify({
				type: "assistant",
				uuid: "a1",
				parentUuid: null,
				sessionId: "s",
				timestamp: "2026-10-03T08:10:17.000Z",
				message: {
					id: "m1",
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_1", name: "screenshot", input: {} },
					],
				},
			}),
			JSON.stringify({
				type: "user",
				uuid: "u1",
				parentUuid: "a1",
				sessionId: "s",
				timestamp: "2026-10-03T08:10:18.000Z",
				message: {
					role: "user",
					content: [
						{
							tool_use_id: "toolu_1",
							type: "tool_result",
							content: [
								{
									type: "image",
									source: {
										type: "base64",
										data: PIXELS_BASE64,
										media_type: "image/png",
									},
								},
							],
						},
					],
				},
			}),
		].join("\n");

		const sources = toolResultImageSources(slimTranscriptText(content));

		expect(sources).toHaveLength(1);
		expect(readInlineImageMarkerFromSource(sources[0])).toEqual(
			EXPECTED_MARKER,
		);
	});

	test("a Codex function output screenshot keeps the marker as its image source", () => {
		const content = [
			JSON.stringify({
				type: "session_meta",
				timestamp: "2026-06-13T14:30:40.000Z",
				payload: { id: "019ec144-99a0-72b0-8261-3c595294f791" },
			}),
			JSON.stringify({
				type: "response_item",
				timestamp: "2026-06-13T14:30:46.000Z",
				payload: {
					type: "function_call",
					call_id: "call_1",
					name: "view_image",
					arguments: JSON.stringify({ path: "/tmp/shot.png" }),
				},
			}),
			JSON.stringify({
				type: "response_item",
				timestamp: "2026-06-13T14:30:47.000Z",
				payload: {
					type: "function_call_output",
					call_id: "call_1",
					output: [
						{
							type: "input_image",
							image_url: `data:image/png;base64,${PIXELS_BASE64}`,
						},
					],
				},
			}),
		].join("\n");

		const sources = toolResultImageSources(slimTranscriptText(content));

		expect(sources).toHaveLength(1);
		expect(readInlineImageMarkerFromSource(sources[0])).toEqual(
			EXPECTED_MARKER,
		);
	});
});
