export {
	claudeCodeAdapter,
	decodeProjectPath,
	extractAgentIds,
	readSubagentFiles,
} from "./adapters/claude-code/index.js";
export { ensureSessionStartHook as ensureClaudeSessionStartHook } from "./adapters/claude-code/settings.js";
export {
	codexAdapter,
	findActiveRolloutFile,
	readCodexSessionMeta,
} from "./adapters/codex/index.js";
export {
	GEMINI_TRANSCRIPT_VERSION,
	type GeminiTranscript,
	geminiAdapter,
	inferAntigravityCwd,
	readGeminiCliRecord,
	translateAntigravityTranscript,
	translateGeminiCliSession,
} from "./adapters/gemini/index.js";
export {
	getInvalidTranscriptTimestampMessage,
	getMissingTranscriptTimestampMessage,
	InvalidTranscriptTimestampError,
	isMissingTranscriptTimestampMessage,
	MissingTranscriptTimestampError,
} from "./errors.js";
export {
	getAdapter,
	getAllAdapters,
	getAvailableAdapters,
	registerAdapter,
} from "./registry.js";
export type {
	AgentAdapter,
	GitInfo,
	IngestContext,
	ScannedProject,
	SessionFile,
	SessionTimestamps,
	UploadContext,
} from "./types.js";
export {
	readFileWithRetry,
	toClickHouseDateTime,
	toDisplayPath,
	walkJsonlFiles,
} from "./utils.js";

// Auto-register adapters
import { claudeCodeAdapter } from "./adapters/claude-code/index.js";
import { codexAdapter } from "./adapters/codex/index.js";
import { geminiAdapter } from "./adapters/gemini/index.js";
import { registerAdapter } from "./registry.js";

registerAdapter(claudeCodeAdapter);
registerAdapter(codexAdapter);
registerAdapter(geminiAdapter);
