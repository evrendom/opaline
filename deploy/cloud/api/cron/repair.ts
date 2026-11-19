import { handleApiMaintenanceRequest } from "../../../../apps/api/src/handlers/api-maintenance.js";
import { createVercelFunctionHandler } from "../../../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleApiMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "rpc-auth",
});
