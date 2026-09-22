import { handleBillingReconciliationMaintenanceRequest } from "../../apps/api/src/handlers/billing-reconciliation-maintenance.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleBillingReconciliationMaintenanceRequest,
	functionGroup: "billing-reconciliation-maintenance",
	publicPathPattern: /^\/api\/cron\/billing$/u,
});
