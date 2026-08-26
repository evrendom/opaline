import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	foreignKey,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { sessionOwnership } from "./session-ownership-schema.js";

export const sessionIngestRevision = pgTable(
	"session_ingest_revision",
	{
		organizationId: text("organization_id").notNull(),
		sessionId: text("session_id").notNull(),
		operationId: text("operation_id").notNull(),
		contentSha256: text("content_sha256").notNull(),
		revision: bigint("revision", { mode: "bigint" }).notNull(),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [
				table.organizationId,
				table.sessionId,
				table.operationId,
				table.contentSha256,
			],
			name: "session_ingest_revision_pkey",
		}),
		foreignKey({
			columns: [table.organizationId, table.sessionId],
			foreignColumns: [
				sessionOwnership.organizationId,
				sessionOwnership.sessionId,
			],
			name: "session_ingest_revision_session_ownership_fk",
		}).onDelete("cascade"),
		uniqueIndex("session_ingest_revision_value_idx").on(
			table.organizationId,
			table.sessionId,
			table.revision,
		),
		check(
			"session_ingest_revision_hash_check",
			sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
		),
		check("session_ingest_revision_value_check", sql`${table.revision} > 0`),
	],
);

export type SessionIngestRevisionSelect =
	typeof sessionIngestRevision.$inferSelect;
export type SessionIngestRevisionInsert =
	typeof sessionIngestRevision.$inferInsert;
