import { sql } from "drizzle-orm";
import {
	bigint,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

export const sessionOwnership = pgTable(
	"session_ownership",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		agentSource: text("agent_source"),
		agentMetadataScannedAt: timestamp("agent_metadata_scanned_at", {
			withTimezone: true,
			mode: "date",
		}),
		agentMetadataScanOutcome: text("agent_metadata_scan_outcome"),
		nativeParentSessionId: text("native_parent_session_id"),
		nativeSubagentModel: text("native_subagent_model"),
		nativeSubagentPath: text("native_subagent_path"),
		nativeLineageProjectedAt: timestamp("native_lineage_projected_at", {
			withTimezone: true,
			mode: "date",
		}),
		nativeLineageProjectedSignature: text("native_lineage_projected_signature"),
		arrivalNotifiedAt: timestamp("arrival_notified_at", {
			withTimezone: true,
			mode: "date",
		}),
		lastContentSha256: text("last_content_sha256"),
		lastContentBytes: integer("last_content_bytes"),
		lastAssistantLineCount: integer("last_assistant_line_count"),
		lastContentShapeJson: text("last_content_shape_json"),
		lastFilterVersion: integer("last_filter_version"),
		lastSessionDate: timestamp("last_session_date", {
			withTimezone: true,
			mode: "date",
		}),
		lastIngestedAt: timestamp("last_ingested_at", {
			withTimezone: true,
			mode: "date",
		}),
		revisionHead: bigint("revision_head", { mode: "bigint" })
			.default(0n)
			.notNull(),
		lastRevision: bigint("last_revision", { mode: "bigint" }),
		usageExtractionGeneration: bigint("usage_extraction_generation", {
			mode: "number",
		})
			.default(0)
			.notNull(),
		lastUsageContentSha256: text("last_usage_content_sha256"),
		lastUsageExtractionVersion: integer("last_usage_extraction_version"),
		lastUsageEventIdentityVersion: integer("last_usage_event_identity_version"),
		lastUsageModelRateCardVersion: text("last_usage_model_rate_card_version"),
		lastUsageEventCount: integer("last_usage_event_count"),
		lastUsageChecksum: text("last_usage_checksum"),
		lastUsageDiagnosticsJson: text("last_usage_diagnostics_json"),
		lastUsageCompletedGeneration: bigint("last_usage_completed_generation", {
			mode: "number",
		}),
		lastUsageCompletedAt: timestamp("last_usage_completed_at", {
			withTimezone: true,
			mode: "date",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.organizationId, table.sessionId],
			name: "session_ownership_pkey",
		}),
		index("session_ownership_user_id_idx").on(table.userId),
		index("session_ownership_arrivals_idx").on(
			table.organizationId,
			table.createdAt,
		),
		index("session_ownership_native_parent_idx")
			.on(table.organizationId, table.userId, table.nativeParentSessionId)
			.where(sql`${table.nativeParentSessionId} IS NOT NULL`),
		index("session_ownership_agent_metadata_scan_idx")
			.on(
				table.createdAt.desc(),
				table.organizationId,
				table.userId,
				table.sessionId,
			)
			.where(
				sql`${table.agentSource} IS NULL AND ${table.agentMetadataScannedAt} IS NULL`,
			),
	],
);

export const sessionOwnershipBackfillState = pgTable(
	"session_ownership_backfill_state",
	{
		backfillKey: text("backfill_key").primaryKey(),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
	},
);

export type SessionOwnershipSelect = typeof sessionOwnership.$inferSelect;
export type SessionOwnershipInsert = typeof sessionOwnership.$inferInsert;
export type SessionOwnershipBackfillStateSelect =
	typeof sessionOwnershipBackfillState.$inferSelect;
export type SessionOwnershipBackfillStateInsert =
	typeof sessionOwnershipBackfillState.$inferInsert;
