import { getLogger } from "@logtape/logtape";
import { startFlyApiLifecycle } from "./fly-lifecycle.js";
import { fetchHandler, MAX_REQUEST_BODY_BYTES } from "./handler.js";

const logger = getLogger(["rudel", "api", "http"]);
const port = process.env.PORT ?? "4010";
const server = Bun.serve({
	fetch: fetchHandler,
	maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
	port,
});
const lifecycle = startFlyApiLifecycle();
let isShuttingDown = false;

async function shutdown(signal?: string): Promise<void> {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;

	await lifecycle.shutdown();
	if (signal) {
		server.stop(true);
		process.exit(0);
	}
}

process.on("beforeExit", () => {
	void shutdown();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void shutdown(signal);
	});
}

logger.info("API server listening on http://localhost:{port}", {
	port: server.port,
});
