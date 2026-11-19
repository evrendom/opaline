import {
	boolean,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

// Per-workspace feature switches set in the admin features page
// (apps/desktop/server/src/services/workspace-features.ts). A row overrides the
// feature's environment list for that workspace, on or off; no row leaves the
// environment list in charge, so a feature behaves as before until someone
// toggles it. Deleted with the workspace.
export const workspaceFeature = pgTable(
	"workspace_feature",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** A key of WORKSPACE_FEATURES (@rudel/api-routes). */
		feature: text("feature").notNull(),
		enabled: boolean("enabled").notNull(),
		/** The admin who set it; null once their account is deleted. */
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [primaryKey({ columns: [table.organizationId, table.feature] })],
);
