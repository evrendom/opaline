import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

export const repositoryEvidenceObject = pgTable(
	"repository_evidence_object",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		objectId: text("object_id").notNull(),
		objectKey: text("object_key").notNull(),
		kind: text("kind").notNull(),
		byteLength: integer("byte_length").notNull(),
		mediaType: text("media_type").notNull(),
		contentEncoding: text("content_encoding").notNull(),
		filterVersion: integer("filter_version"),
		status: text("status").default("pending").notNull(),
		availableAt: timestamp("available_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.organizationId, table.objectId],
			name: "repository_evidence_object_pkey",
		}),
		uniqueIndex("repository_evidence_object_key_uidx").on(table.objectKey),
		index("repository_evidence_object_pending_idx")
			.on(table.updatedAt)
			.where(sql`${table.status} = 'pending'`),
		check(
			"repository_evidence_object_id_check",
			sql`${table.objectId} ~ '^sha256:[0-9a-f]{64}$'`,
		),
		check(
			"repository_evidence_object_kind_check",
			sql`${table.kind} IN ('context-manifest', 'source-blob', 'git-diff', 'transcript-chunk', 'ci-metadata', 'ci-log', 'image')`,
		),
		check(
			"repository_evidence_object_encoding_check",
			sql`${table.contentEncoding} IN ('identity', 'gzip')`,
		),
		check(
			"repository_evidence_object_status_check",
			sql`${table.status} IN ('pending', 'available')`,
		),
		check(
			"repository_evidence_object_size_check",
			sql`${table.byteLength} > 0 AND ${table.byteLength} <= ${sql.raw("67108864")}`,
		),
		check(
			"repository_evidence_object_availability_check",
			sql`(${table.status} = 'available') = (${table.availableAt} IS NOT NULL)`,
		),
	],
);

export const repositoryEvidenceUpload = pgTable(
	"repository_evidence_upload",
	{
		id: text("id").primaryKey(),
		operationId: text("operation_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		contextId: text("context_id").notNull(),
		manifestObjectId: text("manifest_object_id").notNull(),
		status: text("status").default("initialized").notNull(),
		request: jsonb("request").notNull(),
		missingObjectIds: jsonb("missing_object_ids").notNull(),
		receiptId: text("receipt_id"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		committedAt: timestamp("committed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("repository_evidence_upload_operation_uidx").on(
			table.organizationId,
			table.userId,
			table.operationId,
		),
		uniqueIndex("repository_evidence_upload_receipt_uidx")
			.on(table.receiptId)
			.where(sql`${table.receiptId} IS NOT NULL`),
		index("repository_evidence_upload_expiry_idx")
			.on(table.expiresAt)
			.where(sql`${table.status} = 'initialized'`),
		check(
			"repository_evidence_upload_status_check",
			sql`${table.status} IN ('initialized', 'committed', 'failed', 'expired')`,
		),
		check(
			"repository_evidence_upload_json_check",
			sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.missingObjectIds}) = 'array'`,
		),
		check(
			"repository_evidence_upload_terminal_check",
			sql`(${table.status} = 'committed' AND ${table.receiptId} IS NOT NULL AND ${table.committedAt} IS NOT NULL) OR (${table.status} <> 'committed' AND ${table.receiptId} IS NULL AND ${table.committedAt} IS NULL)`,
		),
	],
);

export const repositoryEvidenceUploadObject = pgTable(
	"repository_evidence_upload_object",
	{
		uploadId: text("upload_id")
			.notNull()
			.references(() => repositoryEvidenceUpload.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull(),
		objectId: text("object_id").notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.uploadId, table.objectId],
			name: "repository_evidence_upload_object_pkey",
		}),
		foreignKey({
			columns: [table.organizationId, table.objectId],
			foreignColumns: [
				repositoryEvidenceObject.organizationId,
				repositoryEvidenceObject.objectId,
			],
			name: "repository_evidence_upload_object_object_fk",
		}).onDelete("cascade"),
		index("repository_evidence_upload_object_object_idx").on(
			table.organizationId,
			table.objectId,
		),
	],
);

export const repositoryEvidenceCapture = pgTable(
	"repository_evidence_capture",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		contextId: text("context_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		uploadId: text("upload_id")
			.notNull()
			.references(() => repositoryEvidenceUpload.id, { onDelete: "restrict" }),
		manifestObjectId: text("manifest_object_id").notNull(),
		installationId: text("installation_id").notNull(),
		localRepositoryId: text("local_repository_id").notNull(),
		localWorktreeId: text("local_worktree_id").notNull(),
		provider: text("provider"),
		providerHost: text("provider_host"),
		providerRepositoryId: text("provider_repository_id"),
		providerRepositoryNodeId: text("provider_repository_node_id"),
		providerOwner: text("provider_owner"),
		providerName: text("provider_name"),
		sessionId: text("session_id").notNull(),
		runId: text("run_id").notNull(),
		segmentId: text("segment_id").notNull(),
		agentId: text("agent_id"),
		parentAgentId: text("parent_agent_id"),
		source: text("source").notNull(),
		lifecycle: text("lifecycle").notNull(),
		baseGitCommit: text("base_git_commit"),
		headGitCommit: text("head_git_commit"),
		capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
		coverage: jsonb("coverage").notNull(),
		indexRow: jsonb("index_row"),
		// The capture's saved output rows (rudel.session_saved_outputs), published
		// with its index row; null when the manifest names no saved outputs.
		savedOutputs: jsonb("saved_outputs"),
		// The capture's image rows (rudel.session_images), published with its
		// index row; null when the manifest names no images.
		images: jsonb("images"),
		indexPublishedAt: timestamp("index_published_at", { withTimezone: true }),
		indexNextAttemptAt: timestamp("index_next_attempt_at", {
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.organizationId, table.contextId],
			name: "repository_evidence_capture_pkey",
		}),
		uniqueIndex("repository_evidence_capture_upload_uidx").on(table.uploadId),
		index("repository_evidence_capture_index_pending_idx")
			.on(table.createdAt)
			.where(
				sql`${table.indexPublishedAt} IS NULL AND ${table.indexRow} IS NOT NULL`,
			),
		index("repository_evidence_capture_session_idx").on(
			table.organizationId,
			table.sessionId,
			table.capturedAt,
		),
		index("repository_evidence_capture_repo_idx").on(
			table.organizationId,
			table.localRepositoryId,
			table.capturedAt,
		),
		index("repository_evidence_capture_provider_repo_idx").on(
			table.organizationId,
			table.provider,
			table.providerRepositoryId,
			table.capturedAt,
		),
		check(
			"repository_evidence_capture_source_check",
			sql`${table.source} IN ('claude_code', 'codex', 'gemini')`,
		),
		check(
			"repository_evidence_capture_lifecycle_check",
			sql`${table.lifecycle} IN ('start', 'resume', 'checkpoint', 'end')`,
		),
		check(
			"repository_evidence_capture_provider_check",
			sql`(${table.provider} IS NULL AND ${table.providerHost} IS NULL AND ${table.providerRepositoryId} IS NULL AND ${table.providerRepositoryNodeId} IS NULL AND ${table.providerOwner} IS NULL AND ${table.providerName} IS NULL) OR (${table.provider} = 'github' AND ${table.providerHost} IS NOT NULL AND ${table.providerRepositoryId} IS NOT NULL AND ${table.providerRepositoryNodeId} IS NOT NULL AND ${table.providerOwner} IS NOT NULL AND ${table.providerName} IS NOT NULL)`,
		),
		check(
			"repository_evidence_capture_coverage_check",
			sql`jsonb_typeof(${table.coverage}) = 'array'`,
		),
	],
);

/**
 * Durable write-ahead intents for R2 multipart uploads and object deletions.
 * A row is committed before `CreateMultipartUpload` runs (the upload ID is
 * filled in afterwards) so a crash can never leak an upload the application
 * cannot find. Rows deliberately carry no tenant foreign keys: they must
 * survive account and organization cascades until the sweeper or the purge job
 * has aborted the upload or deleted the object.
 */
export const repositoryEvidenceUploadIntent = pgTable(
	"repository_evidence_upload_intent",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		userId: text("user_id").notNull(),
		uploadReceiptId: text("upload_receipt_id").notNull(),
		objectKey: text("object_key").notNull(),
		uploadId: text("upload_id"),
		deleteObject: boolean("delete_object").default(false).notNull(),
		dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("repository_evidence_upload_intent_due_idx").on(table.dueAt),
		index("repository_evidence_upload_intent_receipt_idx").on(
			table.uploadReceiptId,
		),
		index("repository_evidence_upload_intent_organization_idx").on(
			table.organizationId,
		),
		index("repository_evidence_upload_intent_user_idx").on(table.userId),
		check(
			"repository_evidence_upload_intent_key_check",
			sql`length(btrim(${table.objectKey})) > 0`,
		),
	],
);

export type RepositoryEvidenceObjectSelect =
	typeof repositoryEvidenceObject.$inferSelect;
export type RepositoryEvidenceUploadIntentSelect =
	typeof repositoryEvidenceUploadIntent.$inferSelect;
export type RepositoryEvidenceUploadSelect =
	typeof repositoryEvidenceUpload.$inferSelect;
export type RepositoryEvidenceUploadObjectSelect =
	typeof repositoryEvidenceUploadObject.$inferSelect;
export type RepositoryEvidenceCaptureSelect =
	typeof repositoryEvidenceCapture.$inferSelect;
