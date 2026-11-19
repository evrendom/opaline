import { handleLargeR2IngestWorkerRequest } from "../../../../../apps/api/src/handlers/large-r2-ingest-worker.js";
import { createVercelFunctionHandler } from "../../../../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../../../../apps/api/src/logging.js";

await setupLogging();

export const GET = createVercelFunctionHandler({
	fetch: handleLargeR2IngestWorkerRequest,
	marksActivity: "never",
	functionGroup: "large-r2-ingest-worker",
	publicPathPattern: /^\/api\/cron\/large-r2-ingest$/u,
});
