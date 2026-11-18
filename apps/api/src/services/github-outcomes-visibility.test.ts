import { expect, test } from "bun:test";
import { readGitHubEvidenceUiForceOrgIds } from "../lib/env.js";
import { resolveGitHubOutcomesVisibility } from "./github-outcomes-readiness.service.js";

test("forced org IDs are trimmed, empty IDs dropped, and duplicates removed", () => {
	expect(
		readGitHubEvidenceUiForceOrgIds({
			GITHUB_EVIDENCE_UI_FORCE_ORG_IDS: " a, b, a, , ",
		}),
	).toEqual(["a", "b"]);
	expect(readGitHubEvidenceUiForceOrgIds({})).toEqual([]);
});
test("the demo workspace is always forced, since its GitHub data is seeded", () => {
	expect(
		readGitHubEvidenceUiForceOrgIds({
			GITHUB_EVIDENCE_UI_FORCE_ORG_IDS: "a",
			DEMO_ORGANIZATION_ID: " demo ",
		}),
	).toEqual(["a", "demo"]);
	expect(
		readGitHubEvidenceUiForceOrgIds({ DEMO_ORGANIZATION_ID: "a" }),
	).toEqual(["a"]);
});
test("the global kill switch and installation gate always override forced preview", () => {
	expect(
		resolveGitHubOutcomesVisibility({
			uiEnabled: false,
			forced: true,
			readiness: {
				status: "not_ready",
				firstReadyAt: null,
				details: { activeInstallation: true, repositories: [] },
			},
		}),
	).toBe("hidden");
	expect(
		resolveGitHubOutcomesVisibility({
			uiEnabled: true,
			forced: true,
			readiness: null,
		}),
	).toBe("hidden");
});
