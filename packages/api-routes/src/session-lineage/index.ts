export { extractChildLineageEvidence } from "./child-provenance.js";
export { correlateSessionLineage } from "./correlate.js";
export { extractLaunchAnchors } from "./launch-evidence.js";
export {
	classifyShellLaunch,
	type ShellLaunchClassification,
} from "./shell-launch.js";
export {
	type ChildLineageEvidence,
	getLaunchAnchorId,
	type LaunchAnchor,
	type LineageConfidence,
	type LineageOutcome,
	type LineageProvider,
	type RawLineageSession,
	SESSION_LINEAGE_DEFAULT_MATCH_WINDOW_MS,
	SESSION_LINEAGE_DERIVATION_VERSION,
	type SessionLineageCorrelationResult,
	type SessionLineageEdge,
} from "./types.js";
