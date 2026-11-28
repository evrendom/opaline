import {
	lowerWorkerThreadPriority,
	markThreadAsBackgroundWork,
} from "../lib/background-work.js";
import { runIngestWorkInline } from "../lib/inline-work.js";
import type {
	MaintenanceJobRequest,
	MaintenanceJobResponse,
} from "./maintenance-job-thread.js";
import { OFF_THREAD_JOBS } from "./maintenance-job-thread.js";

void lowerWorkerThreadPriority();
markThreadAsBackgroundWork();
// Work a job would hand to another worker runs here instead.
runIngestWorkInline();

declare const self: {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<MaintenanceJobRequest>) => void,
	): void;
	postMessage(message: MaintenanceJobResponse): void;
};

const logging = import("../logging.js").then(({ setupLogging }) =>
	setupLogging(),
);
process.stderr.write(
	`opaline: maintenance thread ready (usage rollup backfill ${process.env.USAGE_ROLLUP_BACKFILL_ENABLED === "1" ? "on" : "off"})\n`,
);

self.addEventListener("message", (event) => {
	const { id, name, url, authorization } = event.data;
	void (async () => {
		try {
			await logging;
			const load = OFF_THREAD_JOBS[name];
			if (!load) throw new Error(`${name} does not run off the main thread`);
			const handle = await load();
			const response = await handle(
				new Request(url, { headers: { Authorization: authorization } }),
			);
			self.postMessage({
				id,
				status: response.status,
				body: await response.text(),
			});
		} catch (error) {
			self.postMessage({
				id,
				status: 500,
				body: JSON.stringify({
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				}),
			});
		}
	})();
});
