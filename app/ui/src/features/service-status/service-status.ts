export type ServiceStatus = "ok" | "analytics-unavailable" | "unknown";

// Only a readable readiness report that names ClickHouse as down shows the
// banner. Network failures stay "unknown" so an offline browser or a
// cross-origin development setup never claims a provider outage.
export function parseServiceStatus(body: unknown): ServiceStatus {
	if (typeof body !== "object" || body === null) return "unknown";
	const dependencies = (body as { dependencies?: unknown }).dependencies;
	if (typeof dependencies !== "object" || dependencies === null) {
		return "unknown";
	}
	// Prefer the read check: slow ClickHouse writes do not stop analytics.
	// Servers without it report only the strict write check.
	const deps = dependencies as {
		clickhouse?: unknown;
		clickhouse_read?: unknown;
	};
	const clickhouse = deps.clickhouse_read ?? deps.clickhouse;
	if (typeof clickhouse !== "object" || clickhouse === null) return "unknown";
	const status = (clickhouse as { status?: unknown }).status;
	if (status === "ok") return "ok";
	if (status === "unavailable") return "analytics-unavailable";
	return "unknown";
}

export async function fetchServiceStatus(
	apiBaseUrl: string,
	signal?: AbortSignal,
): Promise<ServiceStatus> {
	try {
		const response = await fetch(new URL("/health/ready", apiBaseUrl), {
			cache: "no-store",
			credentials: "omit",
			signal,
		});
		return parseServiceStatus(await response.json());
	} catch {
		return "unknown";
	}
}
