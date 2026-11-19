import { handleSitePageRequest } from "../../../apps/api/src/handlers/site-page-http.js";
import { createVercelFunctionHandler } from "../../../apps/api/src/lib/vercel-function-handler.js";

const handler = createVercelFunctionHandler({
	fetch: handleSitePageRequest,
	functionGroup: "page",
	publicPathPattern: /^\/(?!api(?:\/|$)|rpc(?:\/|$)).*$/u,
});

export {
	handler as GET,
	handler as HEAD,
	handler as POST,
	handler as PUT,
	handler as PATCH,
	handler as DELETE,
	handler as OPTIONS,
};
