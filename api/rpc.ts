import { fetchHandler } from "../apps/api/src/handler.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";
import { VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN } from "../apps/api/src/lib/vercel-route-patterns.js";

const handler = createVercelFunctionHandler({
	fetch: fetchHandler,
	functionGroup: "rpc-auth",
	publicPathPattern: VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN,
});

export {
	handler as DELETE,
	handler as GET,
	handler as HEAD,
	handler as OPTIONS,
	handler as PATCH,
	handler as POST,
	handler as PUT,
};
