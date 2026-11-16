import type {
	LocalSessionInput,
	LocalSessionInputRequest,
} from "../selfhost/local-ingest/session-input.js";

export type { LocalSessionInputRequest };
export type PreparedLocalSession = LocalSessionInput;

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
