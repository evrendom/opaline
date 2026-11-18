import { handleHistoryMaintenanceRequest } from "../../apps/api/src/handlers/history-maintenance.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleHistoryMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "rpc-auth",
});
