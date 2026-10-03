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

// Version 5 persists exact phrase frequencies for dashboard signal filters.
export const SCAN_VERSION = 5;
