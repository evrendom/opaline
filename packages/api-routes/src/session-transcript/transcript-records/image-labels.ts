import {
	formatInlineImageMarkerLabel,
	parseInlineImageMarker,
	readInlineImageMarkerFromSource,
} from "../../inline-image-marker.js";
import { readTranscriptToolOutputText } from "../transcript-tool-output.js";
import { isRecord } from "./line-items.js";

const UNMARKED_IMAGE_LABEL = "[image]";

/**
 * Text for an image content block. Images stored as omission markers keep the
 * fact that they were taken (`[screenshot image/png 85.1 KB sha256:…]`);
 * images uploaded before stripping stay `[image]`. Returns undefined for
 * non-image blocks.
 */
export function readImageBlockLabel(block: unknown): string | undefined {
	if (!isRecord(block)) return undefined;
	if (block.type === "image") {
		const marker =
			readInlineImageMarkerFromSource(block.source) ??
			parseInlineImageMarker(block.data);
		return marker ? formatInlineImageMarkerLabel(marker) : UNMARKED_IMAGE_LABEL;
	}
	if (typeof block.image_url === "string" || isRecord(block.image_url)) {
		const marker = isRecord(block.image_url)
			? parseInlineImageMarker(block.image_url.url)
			: parseInlineImageMarker(block.image_url);
		return marker ? formatInlineImageMarkerLabel(marker) : UNMARKED_IMAGE_LABEL;
	}
	return undefined;
}

/**
 * Codex tool output given as content blocks (or a JSON string of them) that
 * include images: text blocks keep their text and images become labels.
 * Undefined when there is no image or a block is neither text nor image.
 */
export function readCodexImageOutputText(output: unknown): string | undefined {
	const blocks = readOutputBlocks(output);
	if (!blocks?.some((block) => readImageBlockLabel(block) !== undefined)) {
		return undefined;
	}
	const parts: string[] = [];
	for (const block of blocks) {
		const text =
			readImageBlockLabel(block) ?? readTranscriptToolOutputText(block);
		if (text === undefined) return undefined;
		if (text !== "") parts.push(text);
	}
	return parts.join("\n");
}

function readOutputBlocks(output: unknown): readonly unknown[] | undefined {
	if (Array.isArray(output)) return output;
	if (typeof output !== "string" || !output.trimStart().startsWith("[")) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(output);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}
