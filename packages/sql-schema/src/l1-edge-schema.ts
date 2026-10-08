import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgSequence,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

/**
 * Build revisions of the L1 edge worker (docs/adr/0003-l1-evidence-entities-edges.md).
 * Each claim takes the next value, so a stale worker writes a lower ClickHouse
 * `revision` and loses to a later build.
 */
export const l1EdgeRevisionSeq = pgSequence("l1_edge_revision_seq");

/**
 * The edge worker's queue: one row per scope (a session, or a repository's
 * GitHub facts), coalescing requests. A scope is due while
 * `request_count > built_request_count`; a claim takes a lease and a
 * revision, and only the lease holder completes it.
 */
export const l1EdgeScope = pgTable(
	"l1_edge_scope",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		scopeKind: text("scope_kind").notNull(),
		scopeId: text("scope_id").notNull(),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		source: text("source"),
		sessionId: text("session_id"),
		repositoryId: text("repository_id"),
		/** 0 for live changes, 1 for backfill. */
		priority: smallint("priority").default(0).notNull(),
		requestCount: bigint("request_count", { mode: "number" })
			.default(1)
			.notNull(),
		builtRequestCount: bigint("built_request_count", { mode: "number" })
			.default(0)
			.notNull(),
		claimedRequestCount: bigint("claimed_request_count", { mode: "number" }),
		claimedRevision: bigint("claimed_revision", { mode: "number" }),
		builtRevision: bigint("built_revision", { mode: "number" }),
		nextAttemptAt: timestamp("next_attempt_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		leaseToken: text("lease_token"),
		leaseExpiresAt: timestamp("lease_expires_at", {
			withTimezone: true,
			mode: "date",
		}),
		resolverVersion: integer("resolver_version"),
		/** Session: the observation and transcript generation the edges were built from. */
		input: jsonb("input").default({}).notNull(),
		/** Repository: GitHub `synced_at` the edges are projected through. */
		watermark: timestamp("watermark", { withTimezone: true, mode: "date" }),
		/** Session: per repository, the GitHub coverage the edges were built against. */
		coverage: jsonb("coverage").default({}).notNull(),
		edgeCount: integer("edge_count"),
		unresolvedCount: integer("unresolved_count"),
		/** Set when an input expired; the existing edges are kept, never retracted. */
		frozenReason: text("frozen_reason"),
		lastError: text("last_error"),
		builtAt: timestamp("built_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.organizationId, table.scopeKind, table.scopeId],
		}),
		index("l1_edge_scope_due_idx")
			.on(table.priority, table.nextAttemptAt)
			.where(sql`${table.requestCount} > ${table.builtRequestCount}`),
		check(
			"l1_edge_scope_kind_check",
			sql`(${table.scopeKind} = 'session' AND ${table.userId} IS NOT NULL AND ${table.sessionId} IS NOT NULL AND ${table.source} IN ('claude_code', 'codex')) OR (${table.scopeKind} = 'repository' AND ${table.repositoryId} IS NOT NULL AND ${table.userId} IS NULL)`,
		),
	],
);

/**
 * Which session scopes depend on a repository's GitHub facts, so a repository
 * change re-queues them while they are open. `repository_key` is the
 * repository ID, or `name:owner/name` for a repository named while unbound.
 */
export const l1EdgeScopeDependency = pgTable(
	"l1_edge_scope_dependency",
	{
		organizationId: text("organization_id").notNull(),
		repositoryKey: text("repository_key").notNull(),
		scopeKind: text("scope_kind").default("session").notNull(),
		scopeId: text("scope_id").notNull(),
		openUntil: timestamp("open_until", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.organizationId, table.repositoryKey, table.scopeId],
		}),
		foreignKey({
			name: "l1_edge_scope_dependency_scope_fk",
			columns: [table.organizationId, table.scopeKind, table.scopeId],
			foreignColumns: [
				l1EdgeScope.organizationId,
				l1EdgeScope.scopeKind,
				l1EdgeScope.scopeId,
			],
		}).onDelete("cascade"),
		check(
			"l1_edge_scope_dependency_kind_check",
			sql`${table.scopeKind} = 'session'`,
		),
		index("l1_edge_scope_dependency_scope_idx").on(
			table.organizationId,
			table.scopeKind,
			table.scopeId,
		),
	],
);

export type L1EdgeScopeSelect = typeof l1EdgeScope.$inferSelect;
export type L1EdgeScopeInsert = typeof l1EdgeScope.$inferInsert;
