import { sql } from "drizzle-orm";
import {
	bigint,
	index,
	jsonb,
	pgTable,
	smallint,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

/**
 * Stored results of the analysis `sql` tool (docs/adr/0005-agents-query-l1-with-sql.md):
 * the title, SQL and returned result under an id, with every member whose
 * sessions the query could read. Deleting an account deletes the results it
 * ran (cascade) and every result that read its sessions (`owner_ids`, in the
 * account purge); deleting a workspace deletes all of its results. Results
 * expire after 90 days (the daily API maintenance), like exact query results
 * in the analysis log (ADR 0001).
 */
export const analysisSqlResult = pgTable(
	"analysis_sql_result",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		query: text("query").notNull(),
		output: jsonb("output").notNull(),
		ownerIds: text("owner_ids").array().default(sql`'{}'::text[]`).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("analysis_sql_result_organization_idx").on(table.organizationId),
		index("analysis_sql_result_author_idx").on(table.authorId),
		index("analysis_sql_result_owner_ids_idx").using("gin", table.ownerIds),
		index("analysis_sql_result_created_at_idx").on(table.createdAt),
	],
);

/** The per-workspace `sql` quota: one fixed window of queries per workspace. */
export const analysisSqlQuota = pgTable("analysis_sql_quota", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	windowStartedAt: timestamp("window_started_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	queryCount: bigint("query_count", { mode: "number" }).notNull(),
});

/**
 * Slots for agent ClickHouse queries, shared by every API instance
 * (`agent-query-slots.ts`): a row per slot, held by a workspace under a lease
 * while one of its queries runs and free again when released or expired.
 * Deleting a workspace clears its id from the slots it holds.
 */
export const analysisQuerySlot = pgTable("analysis_query_slot", {
	slot: smallint("slot").primaryKey(),
	organizationId: text("organization_id").references(() => organization.id, {
		onDelete: "set null",
	}),
	leaseToken: text("lease_token"),
	leaseExpiresAt: timestamp("lease_expires_at", {
		withTimezone: true,
		mode: "date",
	}),
});
