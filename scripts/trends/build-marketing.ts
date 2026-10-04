import { fetchArtificialAnalysis } from "./fetch-artificial-analysis";
import { fetchOpalineUsage } from "./fetch-opaline-usage";
import { fetchT3Usage } from "./fetch-t3-usage";
import { fetchTrendsSources } from "./fetch-trends-sources";

// Opaline's stored sources first: the API's cron keeps each one's last good
// capture. A source it has not stored yet (or an unreachable API) falls to
// that source's own fetch below, when enabled, and otherwise to preview.
// A failed fetch only leaves this build without that capture: it never sets
// the source's kill switch, so the page still swaps in the stored capture
// once the cron has one.
let stored = { benchmarks: false, harness: false, usage: false };
if (process.env.TRENDS_SOURCES_FETCH === "1") {
	try {
		stored = await fetchTrendsSources();
	} catch (error) {
		console.error(
			"Opaline's stored Trends sources unavailable; falling back per source.",
			error,
		);
	}
}

const usageSource = process.env.TRENDS_USAGE_SOURCE;
if (
	process.env.TRENDS_USAGE_FETCH === "1" &&
	usageSource !== "preview" &&
	!stored.usage
) {
	try {
		await fetchOpalineUsage();
	} catch (error) {
		console.error(
			"Opaline usage unavailable; this build uses synthetic usage until the page loads the stored capture.",
			error,
		);
	}
}

const benchmarkSource = process.env.TRENDS_BENCHMARK_SOURCE;
if (
	process.env.TRENDS_AA_FETCH === "1" &&
	benchmarkSource !== "preview" &&
	!stored.benchmarks
) {
	try {
		await fetchArtificialAnalysis();
	} catch (error) {
		console.error(
			"AA unavailable; this build uses preview benchmarks until the page loads the stored capture.",
			error,
		);
	}
}
const harnessSource = process.env.TRENDS_HARNESS_SOURCE;
if (
	process.env.TRENDS_T3_FETCH === "1" &&
	harnessSource !== "usage" &&
	!stored.harness
) {
	try {
		await fetchT3Usage();
	} catch (error) {
		console.error(
			"T3 Code usage unavailable; this build uses the usage population for Claude Code vs Codex until the page loads the stored capture.",
			error,
		);
	}
}
const build = Bun.spawn(["bun", "run", "astro", "build"], {
	cwd: new URL("../../apps/marketing", import.meta.url).pathname,
	env: {
		...process.env,
		TRENDS_USAGE_SOURCE: usageSource,
		TRENDS_BENCHMARK_SOURCE: benchmarkSource,
		TRENDS_HARNESS_SOURCE: harnessSource,
	},
	stdout: "inherit",
	stderr: "inherit",
});
process.exit(await build.exited);
