import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

/**
 * The daily Trends refresh: fetches Artificial Analysis, Slopalytics and
 * Opaline's own usage, and stores each capture that passes its checks.
 * A source that fails keeps its stored capture; the response says which.
 */
export async function handleTrendsSourcesMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	// Unauthorized probes must not initialize database or provider clients.
	const [
		{ fetchAaRelease, fetchT3Release },
		{ getTrendsUsage },
		{ postgresTrendsSourceStore, refreshTrendsSources, usageCapture },
	] = await Promise.all([
		import("@rudel/api-routes/trends-source-fetch"),
		import("../services/trends-usage.service.js"),
		import("../services/trends-sources.service.js"),
	]);
	const outcomes = await refreshTrendsSources(postgresTrendsSourceStore(), {
		benchmarks: () => fetchAaRelease(),
		harness: () => fetchT3Release(),
		usage: async () => usageCapture(await getTrendsUsage()),
	});
	const ok = Object.values(outcomes).every(
		(outcome) => outcome.status === "stored",
	);
	return Response.json(
		{ trendsSources: outcomes, ok },
		{ status: ok ? 200 : 503 },
	);
}
