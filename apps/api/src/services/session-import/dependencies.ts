import { type ClickHouseExecutor, getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { captureApiProductAnalyticsEvent } from "../../lib/product-analytics.js";
import { recordUserCliVersion } from "../cli-version.service.js";
import { resolveIngestOrganizationId } from "../cli-workspace.service.js";
import { assertNoClickHousePurgeTombstone } from "../clickhouse-purge-tombstone.service.js";
import { persistGitObservationsBestEffort } from "../git-observation-extraction.service.js";
import { filterSessionTextFieldsOffThread } from "../ingest-filter.service.js";
import { enqueueSessionEdgesBestEffort } from "../l1-edges/l1-edge-enqueue.js";
import { hasRawSessionRow } from "../raw-session.service.js";
import {
	persistSessionLanguageSignals,
	persistSessionLanguageSignalsBestEffort,
	persistSessionLanguageSignalsWithExecutor,
} from "../session-language-signal-persistence.service.js";
import { projectNativeSessionLineage } from "../session-native-lineage.service.js";
import {
	claimSessionIngestOwnership,
	recordSessionAgentMetadata,
	recordSessionIngestContent,
	reserveUsageExtractionGeneration,
} from "../session-ownership.service.js";
import { allocateSessionRevision } from "../session-revision.service.js";
import {
	readSkillExtractionReceipt,
	writeSkillExtraction,
} from "../skill-extraction-ingest.service.js";
import {
	isTranscriptRecordsCurrent,
	persistTranscriptRecordsBestEffort,
} from "../transcript-records-extraction.service.js";
import { indexUploadedSessionBestEffort } from "../transcript-search/ingest.js";
import { writeUsageExtraction } from "../usage-event-ingest.service.js";
import { extractSessionFactsOffThread } from "../usage-extraction.service.js";

export interface SessionOwner {
	readonly organizationId: string;
	readonly userId: string;
}

export interface ImportedSession extends SessionOwner {
	readonly sessionId: string;
	readonly source: string;
}

export interface SessionImportDependencies {
	readonly filterText: typeof filterSessionTextFieldsOffThread;
	readonly resolveOrganizationId: (
		requested: string | null,
		userId: string,
	) => Promise<string>;
	readonly claimOwnership: (
		organizationId: string,
		sessionId: string,
		userId: string,
	) => ReturnType<typeof claimSessionIngestOwnership>;
	readonly recordAgentMetadata: typeof recordSessionAgentMetadata;
	readonly projectLineage: typeof projectNativeSessionLineage;
	readonly clickhouse: () => ClickHouseExecutor;
	readonly hasRawRow: typeof hasRawSessionRow;
	readonly allocateRevision: typeof allocateSessionRevision;
	readonly recordContent: typeof recordSessionIngestContent;
	readonly recordCliVersion: (
		userId: string,
		version: unknown,
	) => Promise<void>;
	readonly reserveUsageGeneration: typeof reserveUsageExtractionGeneration;
	readonly assertWritable: (owner: SessionOwner) => Promise<void>;
	readonly persistLanguageSignals: typeof persistSessionLanguageSignals;
	readonly persistLanguageSignalsWith: typeof persistSessionLanguageSignalsWithExecutor;
	readonly persistLanguageSignalsBestEffort: typeof persistSessionLanguageSignalsBestEffort;
	readonly readSkillReceipt: typeof readSkillExtractionReceipt;
	readonly recordsCurrent: typeof isTranscriptRecordsCurrent;
	readonly persistRecords: typeof persistTranscriptRecordsBestEffort;
	readonly persistGitObservations: typeof persistGitObservationsBestEffort;
	readonly indexSearch: typeof indexUploadedSessionBestEffort;
	readonly extractSessionFacts: typeof extractSessionFactsOffThread;
	readonly writeSkills: typeof writeSkillExtraction;
	readonly writeUsage: typeof writeUsageExtraction;
	readonly enqueueRunIndex: (session: ImportedSession) => Promise<void>;
	readonly captureEvent: typeof captureApiProductAnalyticsEvent;
}

export const productionDependencies: SessionImportDependencies = {
	filterText: filterSessionTextFieldsOffThread,
	resolveOrganizationId: (requested, userId) =>
		resolveIngestOrganizationId(requested, userId),
	claimOwnership: (organizationId, sessionId, userId) =>
		claimSessionIngestOwnership(organizationId, sessionId, userId),
	recordAgentMetadata: recordSessionAgentMetadata,
	projectLineage: projectNativeSessionLineage,
	clickhouse: getClickhouse,
	hasRawRow: hasRawSessionRow,
	allocateRevision: allocateSessionRevision,
	recordContent: recordSessionIngestContent,
	recordCliVersion: (userId, version) =>
		recordUserCliVersion(sqlClient, userId, version),
	reserveUsageGeneration: reserveUsageExtractionGeneration,
	assertWritable: (owner) =>
		assertNoClickHousePurgeTombstone(owner, { database: sqlClient }),
	persistLanguageSignals: persistSessionLanguageSignals,
	persistLanguageSignalsWith: persistSessionLanguageSignalsWithExecutor,
	persistLanguageSignalsBestEffort: persistSessionLanguageSignalsBestEffort,
	readSkillReceipt: readSkillExtractionReceipt,
	recordsCurrent: isTranscriptRecordsCurrent,
	persistRecords: persistTranscriptRecordsBestEffort,
	persistGitObservations: persistGitObservationsBestEffort,
	indexSearch: indexUploadedSessionBestEffort,
	extractSessionFacts: extractSessionFactsOffThread,
	writeSkills: writeSkillExtraction,
	writeUsage: writeUsageExtraction,
	enqueueRunIndex: (session) => enqueueSessionEdgesBestEffort(session),
	captureEvent: captureApiProductAnalyticsEvent,
};
