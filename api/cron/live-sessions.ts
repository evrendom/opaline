import { handleLiveSessionsMaintenanceRequest } from "../../apps/api/src/handlers/live-sessions-maintenance.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleLiveSessionsMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "live-sessions-maintenance",
	publicPathPattern: /^\/api\/cron\/live-sessions$/u,
});
