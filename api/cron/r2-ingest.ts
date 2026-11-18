import { handleR2IngestMaintenanceRequest } from "../../apps/api/src/handlers/api-maintenance.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleR2IngestMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "r2-ingest-maintenance",
	publicPathPattern: /^\/api\/cron\/r2-ingest$/u,
});
