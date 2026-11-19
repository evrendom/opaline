import type { SessionLanguageSignalScan } from "./session-language-signal-summary.js";

export interface SessionLanguageSignalScannerWorkerRequest {
	readonly content: string;
	readonly requestId: number;
}

export type SessionLanguageSignalScannerWorkerResponse =
	| {
			readonly summary: SessionLanguageSignalScan;
			readonly requestId: number;
			readonly status: "success";
	  }
	| {
			readonly message: string;
			readonly requestId: number;
			readonly status: "error";
	  };
