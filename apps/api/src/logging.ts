import { AsyncLocalStorage } from "node:async_hooks";
import {
	configure,
	getConsoleSink,
	jsonLinesFormatter,
} from "@logtape/logtape";

const isProduction =
	process.env.NODE_ENV === "production" || !!process.env.FLY_APP_NAME;

export async function setupLogging(): Promise<void> {
	const sinks = {
		console: getConsoleSink({
			formatter: isProduction ? jsonLinesFormatter : undefined,
		}),
	};

	await configure({
		contextLocalStorage: new AsyncLocalStorage(),
		sinks,
		loggers: [
			{
				category: ["rudel", "api"],
				lowestLevel: isProduction ? "info" : "debug",
				sinks: ["console"],
			},
			{
				category: ["logtape", "meta"],
				lowestLevel: "warning",
				sinks: ["console"],
			},
		],
	});
}
