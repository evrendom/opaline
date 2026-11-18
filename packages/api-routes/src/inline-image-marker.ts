/**
 * Inline images (screenshots, pasted images) are not stored. Uploads replace
 * each base64 payload with one marker string that keeps the fact: the SHA-256
 * and length of the decoded bytes and the media type. The CLI writes the same
 * marker client-side; the server strips again on ingest for older clients.
 *
 * The marker uses only characters that need no JSON escaping, so it can stand
 * in for a payload at any JSON-string nesting depth.
 */

export const INLINE_IMAGE_MARKER_PREFIX = "opaline-image-omitted:v1;";

const INLINE_IMAGE_MARKER_PATTERN =
	/^opaline-image-omitted:v1;sha256=([0-9a-f]{64});bytes=(0|[1-9][0-9]{0,15});type=([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+)$/u;
const KIB = 1024;
const MIB = 1024 * 1024;

export interface InlineImageMarker {
	readonly bytes: number;
	readonly mediaType: string;
	readonly sha256: string;
}

export function formatInlineImageMarker(marker: InlineImageMarker): string {
	return `${INLINE_IMAGE_MARKER_PREFIX}sha256=${marker.sha256};bytes=${marker.bytes};type=${marker.mediaType}`;
}

export function parseInlineImageMarker(
	value: unknown,
): InlineImageMarker | undefined {
	if (
		typeof value !== "string" ||
		!value.startsWith(INLINE_IMAGE_MARKER_PREFIX)
	) {
		return undefined;
	}
	const match = INLINE_IMAGE_MARKER_PATTERN.exec(value);
	if (!match?.[1] || !match[2] || !match[3]) return undefined;
	const bytes = Number(match[2]);
	if (!Number.isSafeInteger(bytes)) return undefined;
	return { bytes, mediaType: match[3], sha256: match[1] };
}

/**
 * Finds the marker in the shapes the session page receives: a Claude
 * `{ type: "base64", data }` source, a Codex `{ type: "url", url }` source, or
 * the bare marker string.
 */
export function readInlineImageMarkerFromSource(
	source: unknown,
): InlineImageMarker | undefined {
	if (typeof source === "string") return parseInlineImageMarker(source);
	if (typeof source !== "object" || source === null) return undefined;
	if ("data" in source) {
		const marker = parseInlineImageMarker(source.data);
		if (marker) return marker;
	}
	return "url" in source ? parseInlineImageMarker(source.url) : undefined;
}

/** Records text for a marked image: `[screenshot image/png 85.1 KB sha256:0123456789ab]`. */
export function formatInlineImageMarkerLabel(
	marker: InlineImageMarker,
): string {
	return `[screenshot ${marker.mediaType} ${formatInlineImageSize(marker.bytes)} sha256:${marker.sha256.slice(0, 12)}]`;
}

export function formatInlineImageSize(bytes: number): string {
	if (bytes < KIB) return `${bytes} B`;
	if (bytes < MIB) return `${(bytes / KIB).toFixed(1)} KB`;
	return `${(bytes / MIB).toFixed(1)} MB`;
}
