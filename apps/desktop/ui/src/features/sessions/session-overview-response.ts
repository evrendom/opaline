import { SessionAnalyticsSchema } from "@rudel/api-routes";

// Optional enrichment can lag behind this client during API rollout. Validate
// the core rows without replacing absent metadata or retaining the demo seed.
const sessionOverviewRowsSchema = SessionAnalyticsSchema.array();

export function parseSessionOverviewRows(value: unknown) {
	return sessionOverviewRowsSchema.parse(value);
}
