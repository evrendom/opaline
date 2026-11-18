import { type ClickHouseExecutor, getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { resolveIngestOrganizationId } from "../cli-workspace.service.js";
import { assertNoClickHousePurgeTombstone } from "../clickhouse-purge-tombstone.service.js";
import {
	type GitObservationExtractionInput,
	persistGitObservationsBestEffort,
} from "../git-observation-extraction.service.js";
import { filterSessionTextFieldsOffThread } from "../ingest-filter.service.js";
import { enqueueSessionEdgesBestEffort } from "../l1-edges/l1-edge-enqueue.js";
import { hasRawSessionRow } from "../raw-session.service.js";
import {
	insertSessionLanguageSignalRows,
	persistSessionLanguageSignals,
	type SessionLanguageSignalScanInput,
} from "../session-language-signal-persistence.service.js";
import { scanSessionLanguageSignalsOffThread } from "../session-language-signal-scanner.service.js";
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
	type PersistTranscriptRecordsInput,
	persistTranscriptRecordsBestEffort,
} from "../transcript-records-extraction.service.js";
import { indexUploadedSessionBestEffort } from "../transcript-search/ingest.js";
import type { SessionIndexInput } from "../transcript-search/session-index.service.js";
import {
	type UsageEventWriteInput,
	writeUsageExtraction,
} from "../usage-event-ingest.service.js";
import { extractSessionFactsOffThread } from "../usage-extraction.service.js";

export interface SessionOwner {
	readonly organizationId: string;
	readonly userId: string;
}

export interface ImportedSession extends SessionOwner {
	readonly sessionId: string;
	readonly source: string;
}

export type SessionClaim = Awaited<
	ReturnType<typeof claimSessionIngestOwnership>
>;

export interface SessionControlState {
	readonly claim: (request: {
		readonly requestedOrganizationId: string | null;
		readonly sessionId: string;
		readonly userId: string;
	}) => Promise<{
		readonly organizationId: string;
		readonly ownership: SessionClaim;
	}>;
	readonly recordAgentMetadata: typeof recordSessionAgentMetadata;
	readonly projectLineage: (session: {
		readonly organizationId: string;
		readonly sessionId: string;
		readonly userId: string;
	}) => Promise<unknown>;
	readonly allocateRevision: typeof allocateSessionRevision;
	readonly recordContent: typeof recordSessionIngestContent;
	readonly reserveUsageGeneration: typeof reserveUsageExtractionGeneration;
}

type Fenced<Input> = Omit<Input, "assertWritable" | "onWritten">;

export interface SessionStores {
	readonly executor: () => ClickHouseExecutor;
	readonly hasRawRow: (
		executor: ClickHouseExecutor,
		identity: Parameters<typeof hasRawSessionRow>[0],
	) => Promise<boolean>;
	readonly readSkillReceipt: typeof readSkillExtractionReceipt;
	readonly recordsCurrent: typeof isTranscriptRecordsCurrent;
	readonly persistRecords: (
		executor: ClickHouseExecutor,
		input: Fenced<PersistTranscriptRecordsInput>,
	) => Promise<"failed" | "skipped" | "written">;
	readonly persistGitObservations: (
		executor: ClickHouseExecutor,
		input: Fenced<GitObservationExtractionInput>,
	) => Promise<"failed" | "skipped" | "written">;
	readonly indexSearch: (
		executor: ClickHouseExecutor,
		input: Fenced<SessionIndexInput>,
	) => Promise<void>;
	readonly writeSkills: typeof writeSkillExtraction;
	readonly writeUsage: (
		executor: ClickHouseExecutor,
		input: Fenced<UsageEventWriteInput>,
	) => Promise<unknown>;
	readonly writeLanguageSignals: (
		executor: ClickHouseExecutor,
		input: SessionLanguageSignalScanInput,
		now: () => Date,
	) => Promise<void>;
}

export interface SessionWorkers {
	readonly filter: typeof filterSessionTextFieldsOffThread;
	readonly extractFacts: typeof extractSessionFactsOffThread;
}

export interface RunIndexQueue {
	readonly enqueue: (session: ImportedSession) => Promise<void>;
}

export interface SessionImportDependencies {
	readonly control: SessionControlState;
	readonly stores: SessionStores;
	readonly workers: SessionWorkers;
	readonly runIndex: RunIndexQueue;
}

export type SessionImportOverrides = {
	readonly [Port in keyof SessionImportDependencies]?: Partial<
		SessionImportDependencies[Port]
	>;
};

function fence<Input extends SessionOwner>(
	input: Input,
): Input & { assertWritable: () => Promise<void> } {
	return {
		...input,
		assertWritable: () =>
			assertNoClickHousePurgeTombstone(
				{ organizationId: input.organizationId, userId: input.userId },
				{ database: sqlClient },
			),
	};
}

const QUEUED_BY_THE_IMPORT = { onWritten: async () => {} };

export const productionDependencies: SessionImportDependencies = {
	control: {
		claim: async ({ requestedOrganizationId, sessionId, userId }) => {
			const organizationId = await resolveIngestOrganizationId(
				requestedOrganizationId,
				userId,
			);
			return {
				organizationId,
				ownership: await claimSessionIngestOwnership(
					organizationId,
					sessionId,
					userId,
				),
			};
		},
		recordAgentMetadata: recordSessionAgentMetadata,
		projectLineage: (session) =>
			projectNativeSessionLineage({ ...session, notifyPendingArrival: true }),
		allocateRevision: allocateSessionRevision,
		recordContent: recordSessionIngestContent,
		reserveUsageGeneration: reserveUsageExtractionGeneration,
	},
	stores: {
		executor: getClickhouse,
		hasRawRow: (executor, identity) => hasRawSessionRow(identity, executor),
		readSkillReceipt: readSkillExtractionReceipt,
		recordsCurrent: isTranscriptRecordsCurrent,
		persistRecords: (executor, input) =>
			persistTranscriptRecordsBestEffort(executor, {
				...fence(input),
				...QUEUED_BY_THE_IMPORT,
			}),
		persistGitObservations: (executor, input) =>
			persistGitObservationsBestEffort(executor, {
				...fence(input),
				...QUEUED_BY_THE_IMPORT,
			}),
		indexSearch: (executor, input) =>
			indexUploadedSessionBestEffort(executor, fence(input)),
		writeSkills: writeSkillExtraction,
		writeUsage: (executor, input) =>
			writeUsageExtraction(executor, fence(input)),
		writeLanguageSignals: (executor, input, now) =>
			persistSessionLanguageSignals(input, {
				insertRows: (rows) => insertSessionLanguageSignalRows(executor, rows),
				now,
				scan: scanSessionLanguageSignalsOffThread,
			}),
	},
	workers: {
		filter: filterSessionTextFieldsOffThread,
		extractFacts: extractSessionFactsOffThread,
	},
	runIndex: {
		enqueue: (session) => enqueueSessionEdgesBestEffort(session),
	},
};

export function resolveDependencies(
	overrides: SessionImportOverrides,
): SessionImportDependencies {
	return {
		control: { ...productionDependencies.control, ...overrides.control },
		stores: { ...productionDependencies.stores, ...overrides.stores },
		workers: { ...productionDependencies.workers, ...overrides.workers },
		runIndex: { ...productionDependencies.runIndex, ...overrides.runIndex },
	};
}
