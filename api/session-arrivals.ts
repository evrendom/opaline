import { fetchHandler } from "../apps/api/src/handler.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";

const handler = createVercelFunctionHandler({
	fetch: fetchHandler,
	functionGroup: "session-arrivals",
	publicPathPattern: /^\/api\/sessions\/arrivals\/events$/u,
	streaming: true,
});

export { handler as GET, handler as OPTIONS };
