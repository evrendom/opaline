import { handleLargeR2IngestWorkerHealthRequest } from "../../../apps/api/src/handlers/large-r2-ingest-worker.js";
import { createVercelFunctionHandler } from "../../../apps/api/src/lib/vercel-function-handler.js";

export const GET = createVercelFunctionHandler({
	fetch: async () => handleLargeR2IngestWorkerHealthRequest(),
	functionGroup: "large-r2-ingest-health",
	publicPathPattern: /^\/api\/health$/u,
});
