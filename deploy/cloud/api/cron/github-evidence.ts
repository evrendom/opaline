import { handleGitHubEvidenceMaintenanceRequest } from "../../../../apps/api/src/handlers/github-evidence-maintenance.js";
import { createVercelFunctionHandler } from "../../../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleGitHubEvidenceMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "rpc-auth",
});
