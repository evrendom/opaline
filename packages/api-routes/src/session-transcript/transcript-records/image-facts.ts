import {
	formatInlineImageMarkerLabel,
	INLINE_IMAGE_MARKER_PREFIX,
	type InlineImageMarker,
} from "../../inline-image-marker.js";
import type { LineFacts, LineItem } from "./line-items.js";
import type { ExtraFacts } from "./record-facts.js";

/**
 * Images a record carries (parser 12). Uploads replace each inline image with
 * its marker (`opaline-image-omitted:v1;sha256=<hex>;bytes=<n>;type=<media
 * type>`, `inline-image-marker.ts`), and the CLI stores the bytes as the
 * evidence object `sha256:<hex>` with the session (`rudel.session_images`,
 * keyed by the same stream and record). The `images` fact lists the markers of
 * the record's line as `{sha256, bytes, type}` in order of first appearance,
 * so an image is tied to the exact record and call it came with. The marker
 * needs no JSON escaping, so it is read from the raw line at any nesting depth
 * (tool output JSON-encoded in a string included).
 *
 * A line split into several records gives each record the images its own
 * text labels (`[screenshot <type> <size> sha256:<first 12>]`); images no
 * record's text shows go to the line's first record.
 */

/** Images listed per record; `images_more` counts the rest. */
export const TRANSCRIPT_RECORD_IMAGE_FACT_MAX_ENTRIES = 64;

const MARKER_PATTERN =
	/opaline-image-omitted:v1;sha256=([0-9a-f]{64});bytes=(0|[1-9][0-9]{0,15});type=([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+)/gu;

/** The distinct image markers of one raw JSONL line, in order of first appearance. */
export function readLineImageMarkers(line: string): InlineImageMarker[] {
	if (!line.includes(INLINE_IMAGE_MARKER_PREFIX)) return [];
	const markers = new Map<string, InlineImageMarker>();
	for (const match of line.matchAll(MARKER_PATTERN)) {
		const [, sha256, bytes, mediaType] = match;
		if (!sha256 || !bytes || !mediaType || markers.has(sha256)) continue;
		const size = Number(bytes);
		if (!Number.isSafeInteger(size)) continue;
		markers.set(sha256, { bytes: size, mediaType, sha256 });
	}
	return [...markers.values()];
}

/** The images of each item of a line (same order as `items`). */
export function assignLineImages(
	items: readonly Pick<LineItem, "text">[],
	markers: readonly InlineImageMarker[],
): InlineImageMarker[][] {
	const assigned = items.map((): InlineImageMarker[] => []);
	if (markers.length === 0 || items.length === 0) return assigned;
	if (items.length === 1) return [[...markers]];
	const unassigned: InlineImageMarker[] = [];
	for (const marker of markers) {
		const label = formatInlineImageMarkerLabel(marker);
		const index = items.findIndex((item) => item.text?.includes(label));
		if (index === -1) unassigned.push(marker);
		else assigned[index]?.push(marker);
	}
	assigned[0]?.unshift(...unassigned);
	return assigned;
}

/** The item's facts with its images added; unchanged without images. */
export function withImageFacts(
	facts: LineFacts | undefined,
	images: readonly InlineImageMarker[],
): LineFacts | undefined {
	if (images.length === 0) return facts;
	const kept = images.slice(0, TRANSCRIPT_RECORD_IMAGE_FACT_MAX_ENTRIES);
	const extra: ExtraFacts = {
		...facts?.extra,
		images: JSON.stringify(
			kept.map((image) => ({
				sha256: image.sha256,
				bytes: image.bytes,
				type: image.mediaType,
			})),
		),
	};
	if (images.length > kept.length) {
		extra.images_more = String(images.length - kept.length);
		extra.facts_clipped = [
			...new Set([
				...(extra.facts_clipped ?? "").split(",").filter(Boolean),
				"images",
			]),
		]
			.sort()
			.join(",");
	}
	return { ...facts, extra };
}
