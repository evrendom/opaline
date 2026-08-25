import { fetchHandler } from "../apps/api/src/handler.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";

const handler = createVercelFunctionHandler({
	fetch: fetchHandler,
	functionGroup: "rpc-auth",
	publicPathPattern: /^\/(?:api(?:\/.*)?|health|rpc(?:\/.*)?)$/u,
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
