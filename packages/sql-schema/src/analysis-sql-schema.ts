import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
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
 * ran (cascade) and, in the account purge, every result among whose
 * `owner_ids` it is whose rows carried text (not `counts`); every other one
 * among them loses its result, and its SQL too when that carries text
 * (`query_carries_text`), keeping the title (ADR 0001 as amended).
 * Deleting a workspace deletes all of its results. Results
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
		/** The result; null once removed. */
		output: jsonb("output"),
		ownerIds: text("owner_ids").array().default(sql`'{}'::text[]`).notNull(),
		/**
		 * The shown rows held only numbers, times and ids. False (deleted with
		 * any member it read) for rows with text, and for results stored before it.
		 */
		counts: boolean("counts").default(false).notNull(),
		/**
		 * The SQL has a literal, quoted name or comment, which may be copied
		 * from a transcript: removing the result empties it too. True for
		 * results stored before it.
		 */
		queryCarriesText: boolean("query_carries_text").default(true).notNull(),
		/**
		 * When the result was removed because a member whose sessions it
		 * counted deleted their account; its title and SQL stay so it can be
		 * rerun (ADR 0001 as amended).
		 */
		removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
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

/**
 * Saved analyses whose finding impact rows (ClickHouse
 * `analysis_finding_runs`) must follow a visibility change made in the
 * analysis log (Convex, authoritative). A share or unshare requests a sync
 * here before it changes the analysis; the sync copies the analysis's current
 * visibility and revision to the rows and then clears the request, unless a
 * newer one (a higher `ticket`) arrived meanwhile. Requests left by a failed
 * sync are retried by the minute maintenance pass. No account data: deleting
 * the workspace deletes them (cascade), and a sync of a deleted analysis
 * only clears its request.
 */
export const analysisVisibilitySync = pgTable(
	"analysis_visibility_sync",
	{
		analysisId: text("analysis_id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		ticket: bigint("ticket", { mode: "number" }).default(1).notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		nextAttemptAt: timestamp("next_attempt_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("analysis_visibility_sync_next_attempt_idx").on(table.nextAttemptAt),
		index("analysis_visibility_sync_organization_idx").on(table.organizationId),
	],
);
