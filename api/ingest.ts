import { fetchHandler } from "../apps/api/src/handler.js";
import { createVercelFunctionHandler } from "../apps/api/src/lib/vercel-function-handler.js";
import { VERCEL_INGEST_PUBLIC_PATH_PATTERN } from "../apps/api/src/lib/vercel-route-patterns.js";

// Hobby is intentionally capped at 2 GB / 300 s. At the launch-week Pro
// flip, this group can move to the planned 4 GB / 800 s without changing the
// shared request handler.
const handler = createVercelFunctionHandler({
	fetch: fetchHandler,
	functionGroup: "ingest",
	// Legacy ingestSession is deliberately absent: vercel.json keeps that
	// large-body route on Fly until the CLI adopts direct-to-R2 uploads.
	publicPathPattern: VERCEL_INGEST_PUBLIC_PATH_PATTERN,
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
