import {
	R2_INGEST_PART_SIZE_BYTES,
	type R2IngestObjectInput,
} from "@rudel/api-routes";

export function sortR2IngestObjects(
	objects: readonly R2IngestObjectInput[],
): R2IngestObjectInput[] {
	return [...objects].sort((left, right) => {
		if (left.kind !== right.kind) {
			return left.kind === "main" ? -1 : 1;
		}
		if (left.kind === "main" || right.kind === "main") {
			return 0;
		}
		return left.agentId.localeCompare(right.agentId);
	});
}

export function getR2IngestPartByteLengths(
	byteLength: number,
	partSizeBytes = R2_INGEST_PART_SIZE_BYTES,
): number[] {
	if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
		throw new Error("R2 ingest object byte length must be positive");
	}
	if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes <= 0) {
		throw new Error("R2 ingest part size must be positive");
	}

	const partCount = Math.ceil(byteLength / partSizeBytes);
	return Array.from({ length: partCount }, (_, index) =>
		Math.min(partSizeBytes, byteLength - index * partSizeBytes),
	);
}
