import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { filterKnownSecrets } from "@rudel/secret-filter";
import {
	formatInlineImageMarkerLabel,
	parseInlineImageMarker,
	readInlineImageMarkerFromSource,
} from "./inline-image-marker.js";
import {
	collectInlineImagesFromLine,
	createTranscriptSlimmer,
	slimTranscriptText,
	stripAndCollectInlineImages,
	stripInlineImagesFromLine,
} from "./transcript-slim.js";

const fixtureUrl = (name: string) =>
	new URL(`./__fixtures__/transcript-slim/${name}`, import.meta.url);

const PIXELS = Buffer.from(
	Array.from({ length: 3_001 }, (_, index) => (index * 37 + 11) % 256),
);
const PIXELS_BASE64 = PIXELS.toString("base64");
const PIXELS_SHA256 = createHash("sha256").update(PIXELS).digest("hex");
const PNG_MARKER = `opaline-image-omitted:v1;sha256=${PIXELS_SHA256};bytes=3001;type=image/png`;

function claudeScreenshotLine() {
	return JSON.stringify({
		type: "user",
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
		toolUseResult: {
			type: "image",
			file: { base64: PIXELS_BASE64, type: "image/png", originalSize: 3001 },
		},
		timestamp: "2026-10-03T08:10:18.706Z",
	});
}

function codexScreenshotLine() {
	return JSON.stringify({
		timestamp: "2026-06-13T14:30:47.792Z",
		type: "response_item",
		payload: {
			type: "function_call_output",
			call_id: "call_1",
			output: [
				{
					type: "input_image",
					image_url: `data:image/png;base64,${PIXELS_BASE64}`,
					detail: "original",
				},
			],
		},
	});
}

describe("inline image stripping", () => {
	test("replaces a Claude image source and its Read result with the exact marker", () => {
		const line = claudeScreenshotLine();

		const result = slimTranscriptText(line);

		expect(result).toBe(line.split(PIXELS_BASE64).join(PNG_MARKER));
		const parsed = JSON.parse(result);
		expect(parsed.message.content[0].content[0].source).toEqual({
			type: "base64",
			data: PNG_MARKER,
			media_type: "image/png",
		});
		expect(parsed.toolUseResult.file.base64).toBe(PNG_MARKER);
	});

	test("replaces a Codex image_url data URL with the marker as the value", () => {
		const result = slimTranscriptText(codexScreenshotLine());

		expect(JSON.parse(result).payload.output[0]).toEqual({
			type: "input_image",
			image_url: PNG_MARKER,
			detail: "original",
		});
	});

	test("replaces base64 inside JSON-encoded tool-output strings", () => {
		const output = JSON.stringify([
			{ type: "input_text", text: "captured" },
			{
				type: "input_image",
				image_url: `data:image/jpeg;base64,${PIXELS_BASE64}`,
			},
		]);
		const line = JSON.stringify({
			type: "response_item",
			payload: { type: "function_call_output", call_id: "c", output },
		});

		const result = slimTranscriptText(line);

		const nested = JSON.parse(JSON.parse(result).payload.output);
		expect(nested[1].image_url).toBe(
			PNG_MARKER.replace("type=image/png", "type=image/jpeg"),
		);
		expect(nested[0]).toEqual({ type: "input_text", text: "captured" });
	});

	test("replaces any string value that is entirely an image data URL", () => {
		const jpegMarker = PNG_MARKER.replace("type=image/png", "type=image/jpeg");
		const line = JSON.stringify({
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: {
					type: "McpToolCall",
					result: {
						_meta: {
							"codex/toolSurface": {
								screenshot: {
									pageUrl: "https://example.com",
									url: `data:image/jpeg;base64,${PIXELS_BASE64}`,
								},
							},
						},
					},
				},
				images: [`data:image/png;base64,${PIXELS_BASE64}`],
			},
		});

		const slimmed = slimTranscriptText(line);

		expect(slimmed).toBe(
			line
				.replace(`data:image/jpeg;base64,${PIXELS_BASE64}`, jpegMarker)
				.replace(`data:image/png;base64,${PIXELS_BASE64}`, PNG_MARKER),
		);
	});

	test("keeps data URLs embedded in longer text", () => {
		const line = JSON.stringify({
			type: "response_item",
			payload: {
				type: "message",
				content: [
					{
						type: "output_text",
						text: `const fixture = "data:image/png;base64,${PIXELS_BASE64}";`,
					},
				],
			},
		});

		expect(slimTranscriptText(line)).toBe(line);
	});

	test("replaces MCP image content data", () => {
		const line = JSON.stringify({
			type: "event_msg",
			payload: {
				type: "mcp_tool_call_end",
				result: {
					Ok: {
						content: [
							{ type: "image", data: PIXELS_BASE64, mimeType: "image/webp" },
						],
					},
				},
			},
		});

		const result = slimTranscriptText(line);

		expect(JSON.parse(result).payload.result.Ok.content[0].data).toBe(
			PNG_MARKER.replace("type=image/png", "type=image/webp"),
		);
	});

	test("is idempotent and leaves every other byte unchanged", () => {
		const content = [
			'{"type":"assistant","message":{"content":[{"type":"text","text":"base64 is fine"}]}}',
			claudeScreenshotLine(),
			"not json but mentions base64",
			codexScreenshotLine(),
			"",
		].join("\n");

		const once = slimTranscriptText(content);

		expect(once).not.toContain(PIXELS_BASE64);
		expect(slimTranscriptText(once)).toBe(once);
		expect(once.split("\n")[0]).toBe(content.split("\n")[0]);
		expect(once.split("\n")[2]).toBe("not json but mentions base64");
		expect(once.endsWith("\n")).toBe(true);
	});

	test("leaves non-image and non-base64 payloads unchanged", () => {
		const content = [
			JSON.stringify({
				type: "document",
				source: {
					type: "base64",
					data: PIXELS_BASE64,
					media_type: "application/pdf",
				},
			}),
			JSON.stringify({
				type: "image",
				source: {
					type: "base64",
					data: "not base64!",
					media_type: "image/png",
				},
			}),
			JSON.stringify({ image_url: "https://example.com/a.png" }),
		].join("\n");

		expect(slimTranscriptText(content)).toBe(content);
	});

	test("marker survives secret filtering unchanged", () => {
		const stripped = slimTranscriptText(claudeScreenshotLine());

		expect(filterKnownSecrets(stripped).text).toBe(stripped);
	});
});

describe("inline image markers", () => {
	test("parse the marker from Claude and Codex sources", () => {
		const expected = {
			bytes: 3001,
			mediaType: "image/png",
			sha256: PIXELS_SHA256,
		};

		expect(parseInlineImageMarker(PNG_MARKER)).toEqual(expected);
		expect(
			readInlineImageMarkerFromSource({
				type: "base64",
				data: PNG_MARKER,
				media_type: "image/png",
			}),
		).toEqual(expected);
		expect(
			readInlineImageMarkerFromSource({ type: "url", url: PNG_MARKER }),
		).toEqual(expected);
		expect(
			readInlineImageMarkerFromSource({ type: "base64", data: PIXELS_BASE64 }),
		).toBeUndefined();
		expect(parseInlineImageMarker(`${PNG_MARKER}x;`)).toBeUndefined();
	});

	test("label carries type, size and the hash prefix", () => {
		expect(
			formatInlineImageMarkerLabel({
				bytes: 87_119,
				mediaType: "image/png",
				sha256: PIXELS_SHA256,
			}),
		).toBe(
			`[screenshot image/png 85.1 KB sha256:${PIXELS_SHA256.slice(0, 12)}]`,
		);
	});
});

describe("Codex structural slimming", () => {
	function commandEvent(item: Record<string, unknown>) {
		return JSON.stringify({
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: { type: "CommandExecution", id: "exec-1", ...item },
			},
		});
	}

	test("keeps only aggregated_output when stdout and formatted_output repeat it", () => {
		const slimmed = slimTranscriptText(
			commandEvent({
				aggregated_output: "ok\n",
				exit_code: 0,
				formatted_output: "ok\n",
				stdout: "ok\n",
			}),
		);

		expect(JSON.parse(slimmed).payload.item).toEqual({
			aggregated_output: "ok\n",
			exit_code: 0,
			id: "exec-1",
			type: "CommandExecution",
		});
	});

	test("never drops a copy that differs from aggregated_output", () => {
		const line = commandEvent({
			aggregated_output: "ok\n",
			formatted_output: "something else\n",
			stdout: "partial\n",
		});

		expect(slimTranscriptText(line)).toBe(line);
	});

	test("leaves a record untouched when re-serializing would change other bytes", () => {
		const line =
			'{"type":"event_msg","payload":{"type":"exec_command_end","aggregated_output":"x","stdout":"x","duration":1.0}}';

		expect(slimTranscriptText(line)).toBe(line);
	});

	test("drops compaction history whose items already appeared, keeping new history", () => {
		const prompt = {
			type: "message",
			role: "user",
			content: [{ type: "input_text", text: "fix it" }],
		};
		const unseen = {
			type: "message",
			role: "user",
			content: [{ type: "input_text", text: "only in the compaction" }],
		};
		const content = [
			JSON.stringify({ type: "response_item", payload: prompt }),
			JSON.stringify({
				type: "compacted",
				payload: {
					message: "",
					guardian_history: [{ ...prompt, status: null }],
					replacement_history: [prompt, unseen],
				},
			}),
		].join("\n");

		const compaction = JSON.parse(
			slimTranscriptText(content).split("\n")[1] ?? "",
		);

		expect(compaction.payload).toEqual({
			message: "",
			replacement_history: [prompt, unseen],
		});
	});
});

describe("parity fixtures shared with the CLI", () => {
	test("slims the shared input to exactly the shared expected bytes", async () => {
		const input = await Bun.file(fixtureUrl("input.jsonl")).text();
		const expected = await Bun.file(fixtureUrl("expected.jsonl")).text();

		expect(slimTranscriptText(input)).toBe(expected);
		expect(slimTranscriptText(expected)).toBe(expected);
	});
});

describe("stripping and collecting images in one pass", () => {
	test("gives the bytes and images of the two separate calls, and slims to the same record", async () => {
		const input = await Bun.file(fixtureUrl("input.jsonl")).text();
		const lines = [
			...input.split("\n"),
			claudeScreenshotLine(),
			`${claudeScreenshotLine()}\r`,
			"not json base64",
		];
		const whole = createTranscriptSlimmer();
		const split = createTranscriptSlimmer();
		let imagesSeen = 0;
		for (const line of lines) {
			const { text, images } = stripAndCollectInlineImages(line);
			expect(text).toBe(stripInlineImagesFromLine(line));
			expect(images).toEqual(collectInlineImagesFromLine(line));
			expect(split.slimRecord(text)).toBe(whole.slimRecord(line));
			imagesSeen += images.length;
		}
		expect(imagesSeen).toBeGreaterThan(0);
	});
});
