import { handleApiMaintenanceRequest } from "../../apps/api/src/handlers/api-maintenance.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

export const GET = handleApiMaintenanceRequest;
