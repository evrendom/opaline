export const MAX_INGEST_EVENT_AGE_MS = 366 * 24 * 60 * 60 * 1_000;
export const MAX_INGEST_EVENT_FUTURE_SKEW_MS = 15 * 60 * 1_000;

export class IngestTimestampWindowError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IngestTimestampWindowError";
	}
}

export function assertIngestTimestampWindow(
	timestamps: {
		readonly lastInteractionDate: string;
		readonly sessionDate: string;
	},
	now = new Date(),
): void {
	const sessionTime = Date.parse(timestamps.sessionDate);
	const lastInteractionTime = Date.parse(timestamps.lastInteractionDate);
	const serverTime = now.getTime();
	if (
		!Number.isFinite(sessionTime) ||
		!Number.isFinite(lastInteractionTime) ||
		!Number.isFinite(serverTime)
	) {
		throw new IngestTimestampWindowError(
			"Transcript timestamps must be valid dates",
		);
	}
	if (sessionTime > lastInteractionTime) {
		throw new IngestTimestampWindowError(
			"Transcript timestamps are not in chronological order",
		);
	}
	if (sessionTime < serverTime - MAX_INGEST_EVENT_AGE_MS) {
		throw new IngestTimestampWindowError(
			"Transcript timestamp is outside the accepted historical window",
		);
	}
	if (lastInteractionTime > serverTime + MAX_INGEST_EVENT_FUTURE_SKEW_MS) {
		throw new IngestTimestampWindowError(
			"Transcript timestamp is too far in the future",
		);
	}
}
