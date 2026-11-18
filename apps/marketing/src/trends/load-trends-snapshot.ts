import { aaReleaseSchema } from "../../../../packages/api-routes/src/trends-aa-release";
import { t3UsageReleaseSchema } from "../../../../packages/api-routes/src/trends-t3-usage";
import { trendsUsageCaptureSchema } from "../../../../packages/api-routes/src/trends-usage";
import {
	assembleTrendsSnapshot,
	type TrendsLiveSources,
} from "./assemble-trends-snapshot";

/** The build's snapshot, from the captures the build wrote locally. */
export function loadTrendsSnapshot() {
	const live = liveTrendsSources();
	return assembleTrendsSnapshot({
		usage: live.usage
			? readCapture(
					"Trends uses synthetic usage: no valid local Opaline usage capture.",
					() =>
						trendsUsageCaptureSchema.parse(
							JSON.parse(
								Object.values(
									import.meta.glob<string>("./generated/opaline-usage.json", {
										eager: true,
										import: "default",
										query: "?raw",
									}),
								)[0] ?? "null",
							),
						),
				)
			: null,
		benchmarks: live.benchmarks
			? readCapture(
					"Trends uses preview benchmarks: no valid local AA release.",
					() =>
						aaReleaseSchema.parse(
							JSON.parse(
								Object.values(
									import.meta.glob<string>("./generated/aa-release.json", {
										eager: true,
										import: "default",
										query: "?raw",
									}),
								)[0] ?? "null",
							),
						),
				)
			: null,
		harness: live.harness
			? readCapture(
					"Trends harness balance uses the usage population: no valid local T3 capture.",
					() =>
						t3UsageReleaseSchema.parse(
							JSON.parse(
								Object.values(
									import.meta.glob<string>("./generated/t3-usage.json", {
										eager: true,
										import: "default",
										query: "?raw",
									}),
								)[0] ?? "null",
							),
						),
				)
			: null,
	});
}

/** The kill switches: `preview` (`usage` for the harness balance) keeps a
 * source on preview data, ignoring any capture. */
export function liveTrendsSources(): TrendsLiveSources {
	const usage = process.env.TRENDS_USAGE_SOURCE;
	if (usage && usage !== "preview" && usage !== "opaline")
		throw new Error(`Invalid TRENDS_USAGE_SOURCE: ${usage}`);
	const benchmarks = process.env.TRENDS_BENCHMARK_SOURCE;
	if (
		benchmarks &&
		benchmarks !== "preview" &&
		benchmarks !== "artificial_analysis"
	)
		throw new Error(`Invalid TRENDS_BENCHMARK_SOURCE: ${benchmarks}`);
	const harness = process.env.TRENDS_HARNESS_SOURCE;
	if (harness && harness !== "usage" && harness !== "t3_code")
		throw new Error(`Invalid TRENDS_HARNESS_SOURCE: ${harness}`);
	return {
		usage: usage !== "preview",
		benchmarks: benchmarks !== "preview",
		harness: harness !== "usage",
	};
}

function readCapture<Capture>(warning: string, read: () => Capture) {
	try {
		return read();
	} catch (error) {
		console.warn(warning, error instanceof Error ? error.message : error);
		return null;
	}
}
