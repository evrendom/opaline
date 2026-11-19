import type {
	SessionDetailDerivation,
	SessionDetailRawSnapshot,
} from "./session-detail-derivation.service.js";
import type { SessionDetailDerivationCacheKey } from "./session-detail-derivation-cache.js";

export type SessionDetailDerivationWorkerRequest =
	| {
			readonly requestId: number;
			readonly snapshot: SessionDetailRawSnapshot;
	  }
	| {
			readonly requestId: number;
			readonly load: SessionDetailDerivationCacheKey;
	  };

export interface LoadedSessionDetailSnapshot {
	readonly revision: string;
	readonly source: string;
	readonly rawBytes: number;
	readonly subagents: Readonly<Record<string, string>>;
}

export interface TransferredSessionDetailDerivation
	extends Omit<SessionDetailDerivation, "rawSubagents" | "turnBodies"> {
	readonly turnBodies: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}

export type SessionDetailDerivationWorkerResponse =
	| {
			readonly derivation: TransferredSessionDetailDerivation;
			readonly requestId: number;
			readonly status: "success";
			readonly loaded?: LoadedSessionDetailSnapshot;
	  }
	| {
			readonly requestId: number;
			readonly status: "missing";
	  }
	| {
			readonly message: string;
			readonly requestId: number;
			readonly status: "error";
	  };
