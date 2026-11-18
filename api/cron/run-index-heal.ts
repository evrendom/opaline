import { handleRunIndexHealMaintenanceRequest } from "../../apps/api/src/handlers/run-index-heal-maintenance.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleRunIndexHealMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "rpc-auth",
});
