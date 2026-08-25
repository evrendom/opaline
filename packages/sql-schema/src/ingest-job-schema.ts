import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

export const ingestJob = pgTable(
	"ingest_job",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		source: text("source").notNull(),
		status: text("status").default("pending").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		maxAttempts: integer("max_attempts").default(5).notNull(),
		availableAt: timestamp("available_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		leaseToken: text("lease_token"),
		leaseExpiresAt: timestamp("lease_expires_at", {
			withTimezone: true,
			mode: "date",
		}),
		objectManifest: jsonb("object_manifest").notNull(),
		expectedSizes: jsonb("expected_sizes").notNull(),
		expectedTotalBytes: integer("expected_total_bytes").notNull(),
		clientHashes: jsonb("client_hashes").notNull(),
		ingestMetadata: jsonb("ingest_metadata").notNull(),
		contentSha256: text("content_sha256"),
		result: jsonb("result"),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "date",
		}),
		failedAt: timestamp("failed_at", {
			withTimezone: true,
			mode: "date",
		}),
		objectsDeletedAt: timestamp("objects_deleted_at", {
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
		index("ingest_job_pending_available_idx")
			.on(table.availableAt)
			.where(sql`${table.status} = 'pending'`),
		index("ingest_job_running_lease_expiry_idx")
			.on(table.leaseExpiresAt)
			.where(sql`${table.status} = 'running'`),
		index("ingest_job_cleanup_idx")
			.on(table.completedAt)
			.where(
				sql`${table.status} = 'completed' AND ${table.objectsDeletedAt} IS NULL`,
			),
		index("ingest_job_session_idx").on(table.organizationId, table.sessionId),
		check(
			"ingest_job_status_check",
			sql`${table.status} IN ('pending', 'running', 'completed', 'failed')`,
		),
		check(
			"ingest_job_source_check",
			sql`${table.source} IN ('claude_code', 'codex')`,
		),
		check(
			"ingest_job_attempts_check",
			sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.maxAttempts}`,
		),
		check("ingest_job_max_attempts_check", sql`${table.maxAttempts} > 0`),
		check(
			"ingest_job_expected_total_bytes_check",
			sql`${table.expectedTotalBytes} >= 0 AND ${table.expectedTotalBytes} <= ${128 * 1024 * 1024}`,
		),
		check(
			"ingest_job_json_shape_check",
			sql`jsonb_typeof(${table.objectManifest}) = 'array'
				AND jsonb_typeof(${table.expectedSizes}) = 'object'
				AND jsonb_typeof(${table.clientHashes}) = 'object'
				AND jsonb_typeof(${table.ingestMetadata}) = 'object'`,
		),
		check(
			"ingest_job_content_sha256_check",
			sql`${table.contentSha256} IS NULL OR ${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"ingest_job_lease_check",
			sql`(
				${table.status} = 'running'
				AND ${table.leaseToken} IS NOT NULL
				AND length(btrim(${table.leaseToken})) > 0
				AND ${table.leaseExpiresAt} IS NOT NULL
			) OR (
				${table.status} <> 'running'
				AND ${table.leaseToken} IS NULL
				AND ${table.leaseExpiresAt} IS NULL
			)`,
		),
		check(
			"ingest_job_error_check",
			sql`(${table.lastErrorCode} IS NULL) = (${table.lastErrorMessage} IS NULL)`,
		),
		check(
			"ingest_job_terminal_state_check",
			sql`(
				${table.status} = 'completed'
				AND ${table.completedAt} IS NOT NULL
				AND ${table.failedAt} IS NULL
				AND ${table.contentSha256} IS NOT NULL
				AND ${table.result} IS NOT NULL
			) OR (
				${table.status} = 'failed'
				AND ${table.completedAt} IS NULL
				AND ${table.failedAt} IS NOT NULL
				AND ${table.lastErrorCode} IS NOT NULL
			) OR (
				${table.status} IN ('pending', 'running')
				AND ${table.completedAt} IS NULL
				AND ${table.failedAt} IS NULL
			)`,
		),
	],
);

export type IngestJobSelect = typeof ingestJob.$inferSelect;
export type IngestJobInsert = typeof ingestJob.$inferInsert;
