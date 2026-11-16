export { splitDisplayTextParts } from "./display-boundaries.js";
export { LANGUAGE_SIGNAL_RULES } from "./rules.js";
export {
	MAX_LANGUAGE_SIGNAL_MATCHES,
	mayContainLanguageSignal,
	scanLanguageSignals,
	scanMemberLanguageSignals,
	scanModelLanguageSignals,
	stripSystemInstructionBlocks,
} from "./scanner.js";
export {
	scanModelLanguageSignalSegments,
	summarize,
	summarizeWithMatches,
} from "./summarize.js";
export type {
	BuiltInLanguageSignalCategory,
	DisplayTextPart,
	LanguageSignalCategory,
	LanguageSignalCounts,
	LanguageSignalMatch,
	LanguageSignalSummary,
	LanguageSignalSummaryInput,
	ModelLanguageSignalCategory,
	ModelLanguageSignalMatch,
} from "./types.js";

// Version 7 changes the member frustration rules. It skips 6, which persisted
// rows already carry for run-level facts (SESSION_AGENT_RUN_SCAN_VERSION), so
// every session re-scans.
export const SCAN_VERSION = 7;
