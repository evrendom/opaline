export { splitDisplayTextParts } from "./display-boundaries.js";
export { LANGUAGE_SIGNAL_RULES } from "./rules.js";
export {
	MAX_LANGUAGE_SIGNAL_MATCHES,
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

// Version 3 also repairs version-2 rows persisted without matched-word arrays.
export const SCAN_VERSION = 3;
