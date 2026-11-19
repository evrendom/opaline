import type { IngestSessionInput } from "@rudel/api-routes";
import { extractUsageEvents } from "@rudel/usage-events";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import type { IngestContentShape } from "../../lib/ingest-content-shape.js";
import { slimAndFilterSecrets } from "../../services/ingest-filter.core.js";
import type {
	ImportedSession,
	SessionClaim,
	SessionImportDependencies,
	SessionImportOverrides,
} from "../../services/session-import/index.js";
import { extractSessionSkills } from "../../services/skill-extraction.js";
import type { SkillExtractionReceiptState } from "../../services/skill-extraction-ingest.service.js";

type Claim = Extract<SessionClaim, { owned: true }>;

const NO_CLAIM: Claim = {
	owned: true,
	lastAssistantLineCount: null,
	lastContentBytes: null,
	lastContentSha256: null,
	lastContentShape: null,
	lastFilterVersion: null,
	lastSessionDate: null,
	lastUsageContentSha256: null,
	lastUsageChecksum: null,
	lastUsageExtractionVersion: null,
	lastUsageEventIdentityVersion: null,
	lastUsageModelRateCardVersion: null,
};

export interface MemoryStores {
	readonly dependencies: SessionImportDependencies;
	readonly calls: string[];
	readonly rawRows: { table: string; values: object[] }[];
	readonly runIndex: ImportedSession[];
	recordsCurrent: boolean;
	recordsResult: "written" | "skipped" | "failed";
	gitObservationsResult: "written" | "skipped" | "failed";
	owner: string | null;
}

export function memoryStores(
	overrides: SessionImportOverrides = {},
): MemoryStores {
	const calls: string[] = [];
	const rawRows: { table: string; values: object[] }[] = [];
	const runIndex: ImportedSession[] = [];
	let claim: Claim = NO_CLAIM;
	let revision = 0;
	let skillReceipt: SkillExtractionReceiptState | null = null;
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {
			throw new Error("no statements in memory");
		},
		query: async () => {
			throw new Error("no queries in memory");
		},
		insert: async ({ table, values }) => {
			calls.push(`insert ${table}`);
			rawRows.push({ table, values });
		},
	};
	const dependencies: SessionImportDependencies = {
		control: {
			claim: async ({ requestedOrganizationId, userId }) => {
				calls.push("claim");
				const organizationId = requestedOrganizationId ?? "org";
				if (stores.owner !== null && stores.owner !== userId)
					return {
						organizationId,
						ownership: { owned: false, ownerId: stores.owner },
					};
				stores.owner = userId;
				return { organizationId, ownership: claim };
			},
			recordAgentMetadata: async () => {
				calls.push("agent_metadata");
			},
			projectLineage: async () => {
				calls.push("lineage");
			},
			allocateRevision: async () => {
				calls.push("revision");
				revision += 1;
				return String(revision);
			},
			recordContent: async (
				_organizationId,
				_sessionId,
				contentSha256,
				contentShape: IngestContentShape,
				filterVersion,
				sessionDate,
				_ingestedAt,
				_revision,
				usage,
			) => {
				calls.push(usage ? "content_and_usage_receipt" : "content");
				claim = {
					...claim,
					lastAssistantLineCount: contentShape.assistantLineCount,
					lastContentBytes: contentShape.contentBytes,
					lastContentSha256: contentSha256,
					lastContentShape: contentShape,
					lastFilterVersion: filterVersion,
					lastSessionDate: sessionDate,
					...(usage
						? {
								lastUsageContentSha256: contentSha256,
								lastUsageChecksum: usage.checksum,
								lastUsageExtractionVersion: usage.extractionVersion,
								lastUsageEventIdentityVersion: usage.eventIdentityVersion,
								lastUsageModelRateCardVersion: usage.modelRateCardVersion,
							}
						: {}),
				};
			},
			reserveUsageGeneration: async () => {
				calls.push("usage_generation");
				return String(revision);
			},
			...overrides.control,
		},
		stores: {
			executor: () => executor,
			hasRawRow: async () => {
				calls.push("raw_exists");
				return rawRows.length > 0;
			},
			readSkillReceipt: async () => {
				calls.push("skill_receipt");
				return skillReceipt;
			},
			recordsCurrent: async () => {
				calls.push("records_current");
				return stores.recordsCurrent;
			},
			persistRecords: async (recordsExecutor, input) => {
				calls.push("records");
				if (stores.recordsResult === "written")
					await dependencies.stores.persistGitObservations(
						recordsExecutor,
						input,
					);
				return stores.recordsResult;
			},
			persistGitObservations: async () => {
				calls.push("git_observations");
				return stores.gitObservationsResult;
			},
			indexSearch: async () => {
				calls.push("search_index");
			},
			writeSkills: async (_executor, input) => {
				calls.push("skills");
				skillReceipt = {
					parserVersion: input.extraction.parserVersion,
					sourceContentSha256: input.extraction.sourceContentSha256,
				};
				return undefined as never;
			},
			writeUsage: async () => {
				calls.push("usage");
			},
			writeLanguageSignals: async () => {
				calls.push("language_signals");
			},
			...overrides.stores,
		},
		workers: {
			filter: async (request) => {
				calls.push("filter");
				return slimAndFilterSecrets(request.fields);
			},
			extractFacts: async (request) => {
				calls.push("extract");
				return {
					usage: extractUsageEvents(request.input),
					skills: request.extractSkills
						? extractSessionSkills({
								content: request.input.content,
								sessionDate:
									request.skillSessionDate ?? "1970-01-01T00:00:00.000Z",
								source: request.input.source,
								subagents: request.input.subagents,
							})
						: null,
				};
			},
			...overrides.workers,
		},
		runIndex: {
			enqueue: async (session) => {
				calls.push("run_index");
				runIndex.push(session);
			},
			...overrides.runIndex,
		},
	};
	const stores: MemoryStores = {
		dependencies,
		calls,
		rawRows,
		runIndex,
		recordsCurrent: true,
		recordsResult: "written",
		gitObservationsResult: "skipped",
		owner: null,
	};
	return stores;
}

const HOUR_MS = 60 * 60 * 1000;

export function claudeTranscript(
	turns: number,
	now = Date.now(),
): IngestSessionInput["content"] {
	const lines: string[] = [];
	for (let turn = 0; turn < turns; turn++) {
		const at = (offset: number) =>
			new Date(now - HOUR_MS + turn * 2_000 + offset).toISOString();
		lines.push(
			JSON.stringify({
				type: "user",
				uuid: `user-${turn}`,
				sessionId: "session-1",
				timestamp: at(0),
				message: { role: "user", content: `question ${turn}` },
			}),
			JSON.stringify({
				type: "assistant",
				uuid: `assistant-${turn}`,
				sessionId: "session-1",
				timestamp: at(1_000),
				requestId: `request-${turn}`,
				message: {
					id: `message-${turn}`,
					role: "assistant",
					model: "claude-sonnet-4-5-20250929",
					content: [{ type: "text", text: `answer ${turn}` }],
					usage: { input_tokens: 10 + turn, output_tokens: 5 },
				},
			}),
		);
	}
	return `${lines.join("\n")}\n`;
}
