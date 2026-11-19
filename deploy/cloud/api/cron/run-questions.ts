import { handleRunQuestionsMaintenanceRequest } from "../../../../apps/api/src/handlers/run-questions-maintenance.js";
import { createVercelFunctionHandler } from "../../../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleRunQuestionsMaintenanceRequest,
	marksActivity: "never",
	functionGroup: "rpc-auth",
});
