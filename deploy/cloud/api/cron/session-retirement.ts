import { handleSessionRetirementMaintenanceRequest } from "../../../../apps/api/src/handlers/session-retirement-maintenance.js";
import { createVercelFunctionHandler } from "../../../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleSessionRetirementMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "session-retirement-maintenance",
	publicPathPattern: /^\/api\/cron\/session-retirement$/u,
});
