import {
	foreignKey,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

// One complete CLI snapshot per account, installation, and destination workspace.
export const repositoryUploadReport = pgTable(
	"repository_upload_report",
	{
		organizationId: text("organization_id").notNull(),
		userId: text("user_id").notNull(),
		installationId: text("installation_id").notNull(),
		repositories: jsonb("repositories").notNull(),
		reportedAt: timestamp("reported_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.organizationId, table.userId, table.installationId],
			name: "repository_upload_report_pkey",
		}),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "repository_upload_report_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "repository_upload_report_user_id_fkey",
		}).onDelete("cascade"),
	],
);
