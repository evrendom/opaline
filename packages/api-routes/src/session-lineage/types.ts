import type { Source } from "../schemas/source.js";

export const SESSION_LINEAGE_DERIVATION_VERSION = 1;
export const SESSION_LINEAGE_DEFAULT_MATCH_WINDOW_MS = 120_000;

export type LineageProvider = "claude" | "openai";
export type LineageOutcome = "failed" | "successful" | "unknown";
export type LineageConfidence =
	| "ambiguous"
	| "attested_temporal"
	| "id_echo"
	| "prompt_echo";

export interface RawLineageSession {
	readonly content: string;
	readonly firstIngestedAt: string;
	readonly latestIngestedAt: string;
	readonly organizationId: string;
	readonly projectPath: string;
	readonly sessionDate: string;
	readonly sessionId: string;
	readonly source: Source;
	readonly userId: string;
}

export interface LaunchAnchor {
	readonly anchorTs: string;
	readonly command: string;
	readonly echoedSessionIds: readonly string[];
	readonly operationOrdinal: number;
	readonly parentIngestedAt: string;
	readonly parentSessionDate: string;
	readonly parentSessionId: string;
	readonly parentSource: Source;
	readonly prompt: string;
	readonly targetModel: string | undefined;
	readonly targetProvider: LineageProvider;
	readonly toolUseId: string;
	readonly userId: string;
	readonly organizationId: string;
	readonly workdir: string | undefined;
}

export interface ChildLineageEvidence {
	readonly assistantMessageCount: number;
	readonly childFirstIngestedAt: string;
	readonly childLatestIngestedAt: string;
	readonly childSessionDate: string;
	readonly childSessionId: string;
	readonly childSource: Source;
	readonly childStartTs: string;
	readonly entrypoint: string | undefined;
	readonly model: string;
	readonly organizationId: string;
	readonly originator: string | undefined;
	readonly outcome: LineageOutcome;
	readonly provider: LineageProvider;
	readonly rootPrompt: string | undefined;
	readonly threadSource: string | undefined;
	readonly userId: string;
	readonly workdir: string | undefined;
}

export interface SessionLineageEdge {
	readonly anchor: LaunchAnchor;
	readonly child: ChildLineageEvidence;
	readonly confidence: LineageConfidence;
	readonly countable: boolean;
	readonly reason: string;
}

export interface SessionLineageCorrelationResult {
	readonly edges: readonly SessionLineageEdge[];
	readonly unmatchedAnchorIds: readonly string[];
	readonly unmatchedChildIds: readonly string[];
}

export function getLaunchAnchorId(anchor: LaunchAnchor): string {
	return `${anchor.parentSource}:${anchor.parentSessionId}:${anchor.toolUseId}:${anchor.operationOrdinal}`;
}
