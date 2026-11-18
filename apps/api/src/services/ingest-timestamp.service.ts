const MAXIMUM_FLOOR_LEAD_MS = 60_000;

export function readIngestedAtFloorMs(
	environment: Readonly<Record<string, string | undefined>> = process.env,
	getCurrentTime: () => number = Date.now,
): number | undefined {
	const rawValue = environment.INGESTED_AT_FLOOR_MS;
	if (rawValue === undefined) {
		return undefined;
	}

	if (rawValue.trim() === "") {
		throw new Error("INGESTED_AT_FLOOR_MS must be a non-negative safe integer");
	}

	const floorMs = Number(rawValue);
	if (!Number.isSafeInteger(floorMs) || floorMs < 0) {
		throw new Error("INGESTED_AT_FLOOR_MS must be a non-negative safe integer");
	}
	if (floorMs > getCurrentTime() + MAXIMUM_FLOOR_LEAD_MS) {
		throw new Error(
			"INGESTED_AT_FLOOR_MS must not be more than 60 seconds in the future",
		);
	}

	return floorMs;
}

export const configuredIngestedAtFloorMs = readIngestedAtFloorMs();

export function createMonotonicIngestedAt(
	getCurrentTime: () => number = Date.now,
	floorMs = configuredIngestedAtFloorMs ?? 0,
): () => Date {
	let previousTimestampMs = 0;

	return () => {
		previousTimestampMs = Math.max(
			getCurrentTime(),
			previousTimestampMs + 1,
			floorMs,
		);
		return new Date(previousTimestampMs);
	};
}

export const getNextIngestedAt = createMonotonicIngestedAt();
