import { handleL1EdgesMaintenanceRequest } from "../../../../apps/api/src/handlers/l1-edges-maintenance.js";
import { createVercelFunctionHandler } from "../../../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleL1EdgesMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "rpc-auth",
});
