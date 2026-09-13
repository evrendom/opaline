import { fetchHandler } from "../apps/api/src/handler.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";

const handler = createVercelFunctionHandler({
	fetch: fetchHandler,
	functionGroup: "cli-connection",
	publicPathPattern: /^\/api\/cli\/connections(?:\/.*)?$/u,
	streaming: true,
});

export { handler as GET, handler as POST, handler as OPTIONS };
