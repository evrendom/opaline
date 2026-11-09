import { collectInlineImagesFromLine } from "@rudel/api-routes/transcript-slim";

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export interface ImageStream {
	readonly agentId: string;
	readonly content: string;
}

export interface CollectedImage {
	readonly sha256: string;
	readonly mediaType: string;
	readonly bytes: Uint8Array;
	readonly references: readonly (readonly [string, number])[];
}

export function collectSessionImages(
	streams: readonly ImageStream[],
): CollectedImage[] {
	const images = new Map<
		string,
		{
			sha256: string;
			mediaType: string;
			bytes: Uint8Array;
			references: [string, number][];
		}
	>();
	for (const stream of streams) {
		let start = 0;
		let recordIdx = 0;
		const { content } = stream;
		while (start < content.length) {
			const end = content.indexOf("\n", start);
			const stop = end === -1 ? content.length : end;
			recordIdx += 1;
			if (stop > start) {
				const line = content.slice(start, stop);
				if (line.includes("base64"))
					for (const image of collectInlineImagesFromLine(line)) {
						if (
							image.bytes.byteLength === 0 ||
							image.bytes.byteLength > MAX_IMAGE_BYTES
						)
							continue;
						const known = images.get(image.sha256);
						if (known) known.references.push([stream.agentId, recordIdx]);
						else
							images.set(image.sha256, {
								sha256: image.sha256,
								mediaType: image.mediaType,
								bytes: new Uint8Array(image.bytes),
								references: [[stream.agentId, recordIdx]],
							});
					}
			}
			start = stop + 1;
		}
	}
	return [...images.values()];
}
