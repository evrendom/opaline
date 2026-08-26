import postgres from "postgres";
import { fetchHandler, MAX_REQUEST_BODY_BYTES } from "../../handler.js";
import { setIngestRateLimitEnvironmentForTests } from "../../router.js";
import { createPostgresIngestRateLimitEnvironment } from "../../services/ingest-rate-limit.service.js";

const unavailableDatabase = postgres(
	"postgres://postgres:postgres@127.0.0.1:1/rudel",
	{
		connect_timeout: 1,
		max: 1,
		prepare: false,
	},
);
setIngestRateLimitEnvironmentForTests(
	createPostgresIngestRateLimitEnvironment(unavailableDatabase),
);

const server = Bun.serve({
	fetch(request) {
		return fetchHandler(request);
	},
	maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
	port: 0,
});

console.info(`API server listening on http://localhost:${server.port}`);
