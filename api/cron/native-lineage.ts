import { handleNativeSessionLineageMaintenanceRequest } from "../../apps/api/src/handlers/native-session-lineage-maintenance.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleNativeSessionLineageMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "native-session-lineage-maintenance",
	publicPathPattern: /^\/api\/cron\/native-lineage$/u,
});
