import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

// Operational canaries are isolated from product data and analytics.
export const dependencyHealthProbe = pgTable(
	"dependency_health_probe",
	{
		id: uuid("id").primaryKey(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("dependency_health_probe_created_at_idx").on(table.createdAt),
	],
);
