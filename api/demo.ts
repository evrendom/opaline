import { fetchHandler } from "../apps/api/src/handler.js";
import { createDemoHandler } from "../apps/api/src/handlers/demo-http.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";

const handler = createVercelFunctionHandler({
	fetch: createDemoHandler(fetchHandler),
	functionGroup: "demo",
	publicPathPattern: /^\/api\/demo\/(?:auth|rpc)(?:\/.*)?$/u,
});
export { handler as GET, handler as POST, handler as OPTIONS };
