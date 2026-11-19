import { expect, test } from "bun:test";
import { handleGitHubEvidenceMaintenanceRequest } from "./github-evidence-maintenance.js";

test("GitHub evidence maintenance refuses unauthenticated requests before accessing storage", async () => {
	const response = await handleGitHubEvidenceMaintenanceRequest(
		new Request("https://example.test/api/cron/github-evidence"),
	);
	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({ error: "Unauthorized" });
});
