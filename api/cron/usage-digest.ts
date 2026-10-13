import { handleUsageDigestMaintenanceRequest } from "../../apps/api/src/handlers/usage-digest-maintenance.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleUsageDigestMaintenanceRequest,
	functionGroup: "usage-digest-maintenance",
	publicPathPattern: /^\/api\/cron\/usage-digest$/u,
});
