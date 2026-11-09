import type {
	SessionDetailDerivation,
	SessionDetailRawSnapshot,
} from "./session-detail-derivation.service.js";

export interface SessionDetailDerivationWorkerRequest {
	readonly requestId: number;
	readonly snapshot: SessionDetailRawSnapshot;
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
	  }
	| {
			readonly message: string;
			readonly requestId: number;
			readonly status: "error";
	  };
