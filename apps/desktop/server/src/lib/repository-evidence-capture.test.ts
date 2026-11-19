import { expect, test } from "bun:test";
import { readRepositoryEvidenceCapturePauseSeconds } from "./repository-evidence-capture.js";

test.each([
	undefined,
	"true",
	"FALSE",
	"0",
	"",
	" false ",
])("capture stays enabled for %s", (value) => {
	expect(
		readRepositoryEvidenceCapturePauseSeconds({
			REPOSITORY_EVIDENCE_CAPTURE_ENABLED: value,
		}),
	).toBeUndefined();
});

test.each([
	[undefined, 86_400],
	["", 86_400],
	["invalid", 86_400],
	["Infinity", 86_400],
	["0", 3_600],
	["-1", 3_600],
	["3600.9", 3_600],
	["9999999", 604_800],
	["12345", 12_345],
])("disabled capture clamps %s to %s", (value, expected) => {
	expect(
		readRepositoryEvidenceCapturePauseSeconds({
			REPOSITORY_EVIDENCE_CAPTURE_ENABLED: "false",
			REPOSITORY_EVIDENCE_CAPTURE_PAUSE_SECONDS: value,
		}),
	).toBe(expected);
});
