import { fetchHandler } from "../apps/api/src/handler.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";

// Hobby is intentionally capped at 2 GB / 300 s. At the launch-week Pro
// flip, this group can move to the planned 4 GB / 800 s without changing the
// shared request handler.
const handler = createVercelFunctionHandler({
	fetch: fetchHandler,
	functionGroup: "ingest",
	publicPathPattern:
		/^\/rpc\/(?:ingestSession|ingest\/(?:commit|init|status))\/?$/u,
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
