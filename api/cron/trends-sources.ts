import { handleTrendsSourcesMaintenanceRequest } from "../../apps/api/src/handlers/trends-sources-maintenance.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleTrendsSourcesMaintenanceRequest,
	functionGroup: "trends-sources-maintenance",
	publicPathPattern: /^\/api\/cron\/trends-sources$/u,
});
