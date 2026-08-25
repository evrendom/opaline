import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth-schema.js";

export const ingestProcessingLedger = pgTable(
	"ingest_processing_ledger",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		filteredContentSha256: text("filtered_content_sha256").notNull(),
		filterVersion: integer("filter_version").notNull(),
		status: text("status").default("processing").notNull(),
		rawIngestedAt: timestamp("raw_ingested_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		usageGeneration: bigint("usage_generation", { mode: "number" }),
		result: jsonb("result"),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "date",
		}),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("ingest_processing_ledger_identity_idx").on(
			table.organizationId,
			table.sessionId,
			table.filteredContentSha256,
			table.filterVersion,
		),
		check(
			"ingest_processing_ledger_hash_check",
			sql`${table.filteredContentSha256} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"ingest_processing_ledger_filter_version_check",
			sql`${table.filterVersion} >= 0`,
		),
		check(
			"ingest_processing_ledger_status_check",
			sql`${table.status} IN ('processing', 'completed')`,
		),
		check(
			"ingest_processing_ledger_terminal_check",
			sql`(
				${table.status} = 'completed'
				AND ${table.result} IS NOT NULL
				AND ${table.completedAt} IS NOT NULL
			) OR (
				${table.status} = 'processing'
				AND ${table.completedAt} IS NULL
			)`,
		),
	],
);

export type IngestProcessingLedgerSelect =
	typeof ingestProcessingLedger.$inferSelect;
export type IngestProcessingLedgerInsert =
	typeof ingestProcessingLedger.$inferInsert;
