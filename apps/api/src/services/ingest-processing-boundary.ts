export type IngestProcessingBoundary =
	| {
			store: "clickhouse";
			target: string;
	  }
	| {
			store: "postgres";
			target:
				| "job-completed"
				| "ledger-completed"
				| "raw-receipt"
				| "usage-generation"
				| "usage-receipt";
	  }
	| {
			store: "r2";
			target: "abort-multipart" | "delete-objects" | "multipart-complete";
	  };

export type IngestProcessingFailpoint = (
	boundary: IngestProcessingBoundary,
) => Promise<void>;

export class IngestProcessingCrashSimulationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IngestProcessingCrashSimulationError";
	}
}

export async function passIngestProcessingBoundary(
	failpoint: IngestProcessingFailpoint | undefined,
	boundary: IngestProcessingBoundary,
): Promise<void> {
	await failpoint?.(boundary);
}
