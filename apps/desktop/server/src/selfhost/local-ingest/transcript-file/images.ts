import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InlineImage } from "@rudel/api-routes/transcript-slim";

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/**
 * Where a read keeps the images it found until they are stored. A session can
 * hold hundreds of MB of screenshots; keeping them on disk instead of in the
 * import worker's heap keeps memory flat however many a session has.
 */
export function imageSpillRoot(): string {
	return join(tmpdir(), "opaline-ingest-images");
}

/** Removes images left by reads that ended without storing them (a crash, a stop). */
export function clearImageSpill(): void {
	rmSync(imageSpillRoot(), { recursive: true, force: true });
}

export interface CollectedImage {
	readonly sha256: string;
	readonly mediaType: string;
	readonly byteLength: number;
	/** The decoded bytes, until the read's images are discarded. */
	readonly file: string;
	readonly references: readonly (readonly [string, number])[];
}

export interface ImageCollector {
	readonly add: (
		agentId: string,
		recordIdx: number,
		found: readonly InlineImage[],
	) => void;
	readonly images: () => CollectedImage[];
	/** The folder holding this read's image files, or null when it found none. */
	readonly directory: () => string | null;
	readonly discard: () => void;
}

export function createImageCollector(
	root: string = imageSpillRoot(),
): ImageCollector {
	const images = new Map<
		string,
		{
			sha256: string;
			mediaType: string;
			byteLength: number;
			file: string;
			references: [string, number][];
		}
	>();
	let directory: string | null = null;
	return {
		add(agentId, recordIdx, found) {
			for (const image of found) {
				if (
					image.bytes.byteLength === 0 ||
					image.bytes.byteLength > MAX_IMAGE_BYTES
				)
					continue;
				const known = images.get(image.sha256);
				if (known) {
					known.references.push([agentId, recordIdx]);
					continue;
				}
				if (!directory) {
					mkdirSync(root, { recursive: true });
					directory = mkdtempSync(join(root, "read-"));
				}
				const file = join(directory, image.sha256);
				writeFileSync(file, image.bytes);
				images.set(image.sha256, {
					sha256: image.sha256,
					mediaType: image.mediaType,
					byteLength: image.bytes.byteLength,
					file,
					references: [[agentId, recordIdx]],
				});
			}
		},
		images: () => [...images.values()],
		directory: () => directory,
		discard() {
			if (directory) rmSync(directory, { recursive: true, force: true });
			directory = null;
			images.clear();
		},
	};
}
