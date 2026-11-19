import { lowerWorkerThreadPriority } from "../lib/background-work.js";
import {
	type GitObservationParseInput,
	parseGitObservations,
} from "./git-observation-parser.js";

void lowerWorkerThreadPriority();

declare const self: {
	postMessage(message: unknown): void;
	onmessage: ((event: MessageEvent<GitObservationParseInput>) => void) | null;
};

self.onmessage = (event) => {
	try {
		self.postMessage({
			type: "result",
			rows: parseGitObservations(event.data),
		});
	} catch (error) {
		self.postMessage({
			type: "error",
			message:
				error instanceof Error
					? error.message
					: "Git observation parsing failed",
		});
	}
};
