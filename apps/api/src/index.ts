import { getLogger } from "@logtape/logtape";
import {
	fetchHandler,
	MAX_REQUEST_BODY_BYTES,
	shutdownApi,
} from "./handler.js";

const logger = getLogger(["rudel", "api", "http"]);
const port = process.env.PORT ?? "4010";
const server = Bun.serve({
	fetch(request, server) {
		return fetchHandler(request, {
			socketIp: server.requestIP(request)?.address ?? null,
		});
	},
	maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
	port,
});
let isShuttingDown = false;

async function shutdown(signal?: string): Promise<void> {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;

	await shutdownApi();
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
