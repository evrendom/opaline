import { fetchHandler } from "../apps/api/src/handler.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";
import { handleVercelWrappedFallback } from "../apps/api/src/vercel-wrapped-fallback.js";

// Bare Vercel functions use the Node runtime by default. Keep this entry off
// Edge and Bun because @resvg/resvg-js loads a native Node binary.
const handler = createVercelFunctionHandler({
	fetch: (request) =>
		fetchHandler(request, { fallback: handleVercelWrappedFallback }),
	functionGroup: "wrapped",
	publicPathPattern:
		/^\/wrapped\/[A-Za-z0-9_-]+(?:\/x-card\.png|\/?)$/u,
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
