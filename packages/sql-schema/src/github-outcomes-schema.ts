import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { organization } from "./auth-schema.js";
import { githubRepositoryBinding } from "./github-repository-evidence-schema.js";

export const organizationFeatureReadiness = pgTable(
	"organization_feature_readiness",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		feature: text("feature").notNull(),
		status: text("status").notNull(),
		firstReadyAt: timestamp("first_ready_at", { withTimezone: true }),
		computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
		details: jsonb("details").notNull().default({}),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.feature] }),
		check(
			"organization_feature_readiness_feature_check",
			sql`${table.feature} IN ('pr_totals', 'pr_attribution')`,
		),
		check(
			"organization_feature_readiness_status_check",
			sql`${table.status} IN ('not_ready', 'ready')`,
		),
	],
);

const tenantColumns = () => ({
	organizationId: text("organization_id").notNull(),
	repositoryId: text("repository_id").notNull(),
});
const date = (name: string) => timestamp(name, { withTimezone: true });
const bounded = (name: string) => varchar(name, { length: 512 });
const bindingKey = (
	table: { organizationId: AnyPgColumn; repositoryId: AnyPgColumn },
	name: string,
) =>
	foreignKey({
		name,
		columns: [table.organizationId, table.repositoryId],
		foreignColumns: [
			githubRepositoryBinding.organizationId,
			githubRepositoryBinding.repositoryId,
		],
	}).onDelete("cascade");

export const githubRepositorySweep = pgTable(
	"github_repository_sweep",
	{
		...tenantColumns(),
		dataset: text("dataset").notNull(),
		windowStart: date("window_start").notNull(),
		windowEnd: date("window_end").notNull(),
		cursor: jsonb("cursor").notNull().default({}),
		status: text("status").default("pending").notNull(),
		retentionBoundary: date("retention_boundary"),
		completedAt: date("completed_at"),
		error: bounded("error"),
		updatedAt: date("updated_at").defaultNow().notNull(),
	},
	(table) => [
		bindingKey(table, "github_repository_sweep_binding_fk"),
		primaryKey({
			name: "github_repository_sweep_pkey",
			columns: [
				table.organizationId,
				table.repositoryId,
				table.dataset,
				table.windowStart,
				table.windowEnd,
			],
		}),
		index("github_repository_sweep_pending_idx").on(
			table.status,
			table.dataset,
			table.windowStart,
		),
		check(
			"github_repository_sweep_status_check",
			sql`${table.status} IN ('pending', 'complete', 'split', 'unavailable')`,
		),
		check(
			"github_repository_sweep_dataset_check",
			sql`${table.dataset} IN ('actions', 'jobs', 'attempts', 'pulls', 'external', 'commits')`,
		),
	],
);
