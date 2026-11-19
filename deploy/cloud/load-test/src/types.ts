export const TRANSCRIPT_SOURCES: readonly ["claude_code", "codex"] = [
	"claude_code",
	"codex",
];
export type TranscriptSource = (typeof TRANSCRIPT_SOURCES)[number];

export const ENTROPY_LEVELS: readonly ["low", "medium", "high"] = [
	"low",
	"medium",
	"high",
];
export type EntropyLevel = (typeof ENTROPY_LEVELS)[number];

export const MAX_AGGREGATE_BYTES = 128 * 1024 * 1024;
export const MAX_SUBAGENT_COUNT = 512;
export const MANIFEST_VERSION = 1;

export interface GeneratedTranscriptObject {
	readonly agentId: string | null;
	readonly byteLength: number;
	readonly kind: "main" | "subagent";
	readonly path: string;
	readonly sha256: string;
}

export interface TranscriptManifest {
	readonly aggregateBytes: number;
	readonly entropy: EntropyLevel;
	readonly manifestVersion: typeof MANIFEST_VERSION;
	readonly metadata: {
		readonly projectPath: string;
		readonly sessionId: string;
		readonly source: TranscriptSource;
		readonly upload_mode: "manual";
	};
	readonly objects: readonly GeneratedTranscriptObject[];
	readonly seed: string;
	readonly subagentCount: number;
	readonly timestampLines: number;
	readonly timestampStart: string;
}

export interface GenerateOptions {
	readonly entropy: EntropyLevel;
	readonly outputDirectory: string;
	readonly seed: string;
	readonly source: TranscriptSource;
	readonly subagentCount: number;
	readonly timestampLines: number;
	readonly timestampStart: string;
	readonly totalBytes: number;
}
