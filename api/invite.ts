import { fetchHandler } from "../apps/api/src/handler.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";
import { handleVercelInviteFallback } from "../apps/api/src/vercel-invite-fallback.js";

const handler = createVercelFunctionHandler({
	fetch: (request) =>
		fetchHandler(request, { fallback: handleVercelInviteFallback }),
	functionGroup: "invite",
	publicPathPattern:
		/^\/(?:(?:[^/]+\/join|team\/invite)\/[A-Za-z0-9_-]+(?:\/og\.png)?\/?)$/u,
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
