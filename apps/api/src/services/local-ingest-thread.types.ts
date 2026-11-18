import type {
	Owner,
	SessionJob,
	SessionOutcome,
} from "../selfhost/local-ingest/service.js";
import type { IngestPhaseTotal } from "./ingest-phase-timings.js";

export type LocalIngestThreadRequest =
	| {
			readonly type: "session";
			readonly id: number;
			readonly job: SessionJob;
			readonly owner: Owner;
	  }
	| { readonly type: "inline" };

export interface LocalIngestThreadResponse {
	readonly id: number;
	readonly outcome: SessionOutcome;
	readonly timings: Readonly<Record<string, IngestPhaseTotal>>;
}
