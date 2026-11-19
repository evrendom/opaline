import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	LANGUAGE_SIGNAL_RULES,
	SCAN_VERSION,
	scanLanguageSignals,
	scanMemberLanguageSignals,
	scanModelLanguageSignalSegments,
} from "@rudel/language-signals";
import { captureSessionLanguageSignals } from "../services/session-language-signal-summary.js";

// Append-only history: semantic changes get a new version and a new entry.
// Never rewrite a fingerprint already assigned to a persisted scan version.
const fingerprintsByVersion: Readonly<Record<number, string>> = {
	1: "6125da80b0cf03ca5fd644bcb6d0c461831c077ff8e4ba1383279dce6715c166",
	2: "538139f31d5549b2ac8c191f3eacc55f20ae95a568c400058af47281a3c9af45",
	// Same scanner semantics; reprocess legacy version-2 count-only records.
	3: "538139f31d5549b2ac8c191f3eacc55f20ae95a568c400058af47281a3c9af45",
	// Negative member counts, followed by exact per-phrase frequency maps.
	4: "083a0b78ac8523eff65f0e2f667cf0116241abd1a0c1569e054f0df484da2686",
	5: "39adbbfba8621f3129931bb7849bc9df7aaeec6bfa55d81ea41ec8eb7624b29a",
	6: "39adbbfba8621f3129931bb7849bc9df7aaeec6bfa55d81ea41ec8eb7624b29a",
	7: "e119b29c251eb10484a70ef0a39c00903e040d638e501951212384e31a451dd7",
	8: "0af806a00b99b63138817c5aeb023e2489ff769fe68cfe412a99d92573908e90",
	// Two-word swearing window, short-verdict sentences, and agent text counted only as apologies.
	9: "3a153b7cdb8e773723563ce3cffb28dd66f932cbea29e96892badc8ad128e4ef",
};

describe("persisted language-signal semantics", () => {
	test("requires a scan-version bump when any persisted scan semantic changes", () => {
		const fingerprint = createHash("sha256")
			.update(JSON.stringify(buildSemanticGoldenCorpusOutput()))
			.digest("hex");
		const knownVersions = Object.keys(fingerprintsByVersion)
			.map(Number)
			.sort((left, right) => left - right);
		const expectedFingerprint = fingerprintsByVersion[SCAN_VERSION];
		assert(expectedFingerprint);

		expect(knownVersions).toEqual(
			Array.from({ length: SCAN_VERSION }, (_, index) => index + 1),
		);
		expect(fingerprint).toBe(expectedFingerprint);
	});
});

function buildSemanticGoldenCorpusOutput() {
	const memberText =
		"Not great. greatish. Great <system_instruction>Sorry fishy fuck</system_instruction> sorry fuck??";
	return {
		boundaryAndNegation: scanLanguageSignals(
			"Not great. greatish. Great fishyish fishy??",
		),
		displaySegments: scanModelLanguageSignalSegments([
			"Sorry `fishy`",
			"did not",
			"work",
			"fuck??",
		]),
		memberPreprocessing: scanMemberLanguageSignals(memberText),
		persistedSummary: captureSessionLanguageSignals(
			buildSemanticTranscript(memberText),
		),
		ruleSurfaceOutputs: LANGUAGE_SIGNAL_RULES.flatMap((rule) =>
			rule.surfaces.map((surface) => scanLanguageSignals(surface)),
		),
	};
}

function buildSemanticTranscript(memberText: string) {
	return [
		{
			message: { content: memberText, role: "user" },
			sessionId: "semantic-session",
			timestamp: "2026-08-20T08:00:00.000Z",
			type: "user",
			uuid: "semantic-member",
		},
		{
			isCompactSummary: true,
			message: { content: "Great sorry fuck", role: "user" },
			sessionId: "semantic-session",
			timestamp: "2026-08-20T08:00:01.000Z",
			type: "user",
			uuid: "semantic-hidden-compaction-summary",
		},
		{
			message: {
				content: [{ text: "Sorry `fishy` fuck", type: "text" }],
				role: "assistant",
			},
			sessionId: "semantic-session",
			timestamp: "2026-08-20T08:00:02.000Z",
			type: "assistant",
			uuid: "semantic-model",
		},
	]
		.map((entry) => JSON.stringify(entry))
		.join("\n");
}
