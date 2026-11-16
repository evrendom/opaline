import type { getAdapter, SessionTimestamps } from "@rudel/agent-adapters";
import type { IngestSessionInput } from "@rudel/api-routes";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import type { IngestContentShape } from "../../lib/ingest-content-shape.js";
import type { IngestFilterResult } from "../ingest-filter.types.js";
import type { ClaimedIngestProcessingLedger } from "../ingest-processing-ledger.service.js";
import type { R2IngestProcessorResult } from "../r2-ingest-commit.service.js";
import type { TranscriptRecordsExtractionConfig } from "../transcript-records-extraction.service.js";
import type {
	ImportedSession,
	SessionClaim,
	SessionImportDependencies,
} from "./dependencies.js";
import type { SessionImportRequest } from "./import-session.js";

export interface AdmittedSession {
	readonly adapter: ReturnType<typeof getAdapter>;
	readonly filteredInput: IngestSessionInput;
	readonly filteredText: IngestFilterResult;
	readonly timestamps: SessionTimestamps;
}

export interface ClaimedSession extends AdmittedSession {
	readonly contentShape: IngestContentShape;
	readonly orgId: string;
	readonly ownership: Extract<SessionClaim, { owned: true }>;
}

export interface PreparedSession extends ClaimedSession {
	readonly contentHash: string;
}

export type ImportResponse = R2IngestProcessorResult["result"];

export interface ImportRun {
	readonly claimedLedger: ClaimedIngestProcessingLedger | undefined;
	readonly clickhouse: ClickHouseExecutor;
	readonly deps: SessionImportDependencies;
	readonly enabled: {
		readonly records: TranscriptRecordsExtractionConfig;
		readonly skills: boolean;
		readonly usage: boolean;
	};
	readonly prepared: PreparedSession;
	readonly request: SessionImportRequest;
	readonly response: ImportResponse;
	readonly subagents: Readonly<Record<string, string>>;
}

export interface StoredRevision {
	readonly ingestedAt: Date;
	readonly revision: string;
}

export function importedSession(run: ImportRun): ImportedSession {
	return {
		organizationId: run.prepared.orgId,
		userId: run.request.context.user.id,
		source: run.prepared.filteredInput.source,
		sessionId: run.request.input.sessionId,
	};
}

export function storedResult(run: ImportRun): R2IngestProcessorResult {
	return { contentSha256: run.prepared.contentHash, result: run.response };
}
