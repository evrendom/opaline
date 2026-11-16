import { lowerWorkerThreadPriority } from "../lib/background-work.js";
import { runIngestWorkInline } from "../lib/inline-work.js";
import type { SessionOutcome } from "../selfhost/local-ingest/service.js";
import {
	readIngestPhaseTotals,
	resetIngestPhaseTotals,
} from "./ingest-phase-timings.js";
import type {
	LocalIngestThreadRequest,
	LocalIngestThreadResponse,
} from "./local-ingest-thread.types.js";

void lowerWorkerThreadPriority();

declare const self: {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<LocalIngestThreadRequest>) => void,
	): void;
	postMessage(message: LocalIngestThreadResponse): void;
};

const startedAt = performance.now();
const runner = (async () => {
	const [
		{ setupLogging },
		{ sqlClient },
		{ loadSessionRunner },
		{ buildLocalSessionInput },
	] = await Promise.all([
		import("../logging.js"),
		import("../db.js"),
		import("../selfhost/local-ingest/runner.js"),
		import("../selfhost/local-ingest/session-input.js"),
	]);
	await setupLogging();
	const run = await loadSessionRunner({
		sql: sqlClient,
		prepare: buildLocalSessionInput,
		log: (line) => process.stderr.write(`opaline: ${line}\n`),
	});
	process.stderr.write(
		`opaline: import thread ready in ${Math.round(performance.now() - startedAt)} ms\n`,
	);
	return run;
})();

function takeTimings(): LocalIngestThreadResponse["timings"] {
	const timings = readIngestPhaseTotals();
	resetIngestPhaseTotals();
	return timings;
}

self.addEventListener("message", (event) => {
	if (event.data.type === "inline") {
		runIngestWorkInline();
		return;
	}
	const { id, job, owner } = event.data;
	void (async () => {
		let outcome: SessionOutcome;
		try {
			outcome = await (await runner)(job, owner);
		} catch (error) {
			outcome = {
				kind: "retry",
				reason: error instanceof Error ? error.message : String(error),
			};
		}
		self.postMessage({ id, outcome, timings: takeTimings() });
	})();
});
