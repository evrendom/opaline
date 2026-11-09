import type { IngestSessionInput } from "@rudel/api-routes";
import type { CollectedImage } from "../selfhost/local-ingest/image-collection.js";

export interface LocalSessionInputRequest {
	readonly sessionPath: string;
	readonly source: "claude_code" | "codex";
	readonly organizationId: string;
	readonly now: number;
}

export type PreparedLocalSession =
	| {
			readonly kind: "ready";
			readonly input: IngestSessionInput;
			readonly bytes: number;
			readonly images: readonly CollectedImage[];
	  }
	| { readonly kind: "skipped"; readonly reason: string };

export type LocalSessionInputWorkerResponse =
	| {
			readonly requestId: number;
			readonly status: "ok";
			readonly prepared: PreparedLocalSession;
	  }
	| {
			readonly requestId: number;
			readonly status: "error";
			readonly message: string;
	  };
