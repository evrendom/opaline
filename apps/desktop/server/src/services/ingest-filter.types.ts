import type { IngestSessionInput } from "@rudel/api-routes";
import type { SessionTextFilterResult } from "@rudel/secret-filter";

type IngestSubagent = NonNullable<IngestSessionInput["subagents"]>[number];

export interface IngestFilterFields {
	readonly content: string;
	readonly subagents: IngestSessionInput["subagents"];
	/**
	 * The text was slimmed with the same rules already (local import), so
	 * slimming it again would only cost another full copy and parse.
	 */
	readonly slimmed?: boolean;
}

export interface IngestFilterResult
	extends SessionTextFilterResult<IngestSubagent> {
	/** UTF-8 bytes secret filtering ran on: the upload after slimming. */
	readonly filterInputBytes: number;
}

export interface IngestFilterWorkerRequest {
	readonly requestId: number;
	readonly fields: IngestFilterFields;
}

export type IngestFilterWorkerErrorResponse =
	| {
			readonly status: "error";
			readonly requestId: number;
			readonly reason: "did-not-converge";
			readonly maxPasses: number;
	  }
	| {
			readonly status: "error";
			readonly requestId: number;
			readonly reason: "json-integrity";
	  }
	| {
			readonly status: "error";
			readonly requestId: number;
			readonly reason: "worker-error";
			readonly message: string;
	  };

export type IngestFilterWorkerResponse =
	| {
			readonly status: "success";
			readonly requestId: number;
			readonly result: IngestFilterResult;
	  }
	| IngestFilterWorkerErrorResponse;
