import type { LanguageSignalSummary } from "@rudel/language-signals";

export interface SessionLanguageSignalScannerWorkerRequest {
	readonly content: string;
	readonly requestId: number;
}

export type SessionLanguageSignalScannerWorkerResponse =
	| {
			readonly summary: LanguageSignalSummary;
			readonly requestId: number;
			readonly status: "success";
	  }
	| {
			readonly message: string;
			readonly requestId: number;
			readonly status: "error";
	  };
