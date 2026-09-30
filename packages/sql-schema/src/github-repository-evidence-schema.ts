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
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

export const githubAppInstallation = pgTable(
	"github_app_installation",
	{
		installationId: text("installation_id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		accountId: text("account_id").notNull(),
		accountLogin: text("account_login").notNull(),
		accountType: text("account_type").notNull(),
		repositorySelection: text("repository_selection").notNull(),
		permissions: jsonb("permissions").notNull(),
		status: text("status").default("active").notNull(),
		installedByUserId: text("installed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		installedAt: timestamp("installed_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("github_app_installation_workspace_uidx").on(
			table.organizationId,
			table.installationId,
		),
		index("github_app_installation_org_idx").on(table.organizationId),
		check(
			"github_app_installation_account_type_check",
			sql`${table.accountType} IN ('Organization', 'User')`,
		),
		check(
			"github_app_installation_selection_check",
			sql`${table.repositorySelection} IN ('all', 'selected')`,
		),
		check(
			"github_app_installation_status_check",
			sql`${table.status} IN ('active', 'suspended', 'deleted')`,
		),
		check(
			"github_app_installation_permissions_check",
			sql`jsonb_typeof(${table.permissions}) = 'object'`,
		),
	],
);

export const githubRepositoryBinding = pgTable(
	"github_repository_binding",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id").notNull(),
		installationId: text("installation_id").notNull(),
		nodeId: text("node_id").notNull(),
		owner: text("owner").notNull(),
		name: text("name").notNull(),
		fullName: text("full_name").notNull(),
		defaultBranch: text("default_branch").notNull(),
		isPrivate: boolean("is_private").notNull(),
		status: text("status").default("active").notNull(),
		lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		foreignKey({
			name: "github_repository_binding_workspace_installation_fk",
			columns: [table.organizationId, table.installationId],
			foreignColumns: [
				githubAppInstallation.organizationId,
				githubAppInstallation.installationId,
			],
		}).onDelete("cascade"),
		primaryKey({
			columns: [table.organizationId, table.repositoryId],
			name: "github_repository_binding_pkey",
		}),
		uniqueIndex("github_repository_binding_name_uidx").on(
			table.organizationId,
			table.owner,
			table.name,
		),
		index("github_repository_binding_installation_idx").on(
			table.installationId,
		),
		check(
			"github_repository_binding_status_check",
			sql`${table.status} IN ('active', 'removed')`,
		),
	],
);

export const githubEvidenceCollection = pgTable(
	"github_evidence_collection",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id").notNull(),
		installationId: text("installation_id").notNull(),
		initiatedByUserId: text("initiated_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		sessionId: text("session_id").default("").notNull(),
		sessionSource: text("session_source").default("").notNull(),
		sessionUserId: text("session_user_id").default("").notNull(),
		contextId: text("context_id").default("").notNull(),
		commitSha: text("commit_sha").notNull(),
		attemptNumber: integer("attempt_number").default(1).notNull(),
		retryCount: integer("retry_count").default(0).notNull(),
		retryOfCollectionId: text("retry_of_collection_id"),
		status: text("status").default("collecting").notNull(),
		sourceVersion: text("source_version").notNull(),
		coverage: jsonb("coverage").notNull(),
		metadataObjectId: text("metadata_object_id"),
		metadataObjectKey: text("metadata_object_key"),
		metadataChunks: jsonb("metadata_chunks")
			.default(sql`'[]'::jsonb`)
			.notNull(),
		observationStartedAt: timestamp("observation_started_at", {
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		refreshDueAt: timestamp("refresh_due_at", { withTimezone: true }),
		error: text("error"),
		startedAt: timestamp("started_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		retryAfter: timestamp("retry_after", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		foreignKey({
			name: "github_evidence_collection_workspace_installation_fk",
			columns: [table.organizationId, table.installationId],
			foreignColumns: [
				githubAppInstallation.organizationId,
				githubAppInstallation.installationId,
			],
		}).onDelete("restrict"),
		index("github_evidence_collection_refresh_idx")
			.on(table.refreshDueAt)
			.where(sql`${table.refreshDueAt} IS NOT NULL`),
		uniqueIndex("github_evidence_collection_identity_uidx").on(
			table.organizationId,
			table.repositoryId,
			table.commitSha,
			table.sessionId,
			table.contextId,
			table.attemptNumber,
		),
		index("github_evidence_collection_pending_idx")
			.on(table.startedAt)
			.where(sql`${table.status} = 'collecting'`),
		index("github_evidence_collection_queue_idx")
			.on(table.retryAfter)
			.where(sql`${table.status} = 'queued'`),
		index("github_evidence_collection_commit_idx").on(
			table.organizationId,
			table.repositoryId,
			table.commitSha,
		),
		index("github_evidence_collection_retry_idx")
			.on(table.retryAfter)
			.where(
				sql`${table.status} IN ('failed', 'partial') AND ${table.retryAfter} IS NOT NULL`,
			),
		check(
			"github_evidence_collection_sha_check",
			sql`${table.commitSha} ~ '^[0-9a-f]{40}$'`,
		),
		check(
			"github_evidence_collection_status_check",
			sql`${table.status} IN ('queued', 'collecting', 'complete', 'partial', 'failed', 'cancelled')`,
		),
		check(
			"github_evidence_collection_attempt_check",
			sql`${table.attemptNumber} > 0 AND ${table.retryCount} >= 0`,
		),
		check(
			"github_evidence_collection_lease_check",
			sql`(${table.status} = 'collecting') = (${table.leaseExpiresAt} IS NOT NULL)`,
		),
		check(
			"github_evidence_collection_coverage_check",
			sql`jsonb_typeof(${table.coverage}) = 'object'`,
		),
		check(
			"github_evidence_collection_receipt_check",
			sql`(${table.metadataObjectId} IS NULL) = (${table.metadataObjectKey} IS NULL)`,
		),
		check(
			"github_evidence_collection_metadata_chunks_check",
			sql`jsonb_typeof(${table.metadataChunks}) = 'array'`,
		),
	],
);

export const githubCiLogReceipt = pgTable(
	"github_ci_log_receipt",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		collectionId: text("collection_id")
			.notNull()
			.references(() => githubEvidenceCollection.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id").notNull(),
		workflowRunId: text("workflow_run_id").notNull(),
		runAttempt: integer("run_attempt").notNull(),
		jobId: text("job_id").notNull(),
		jobName: text("job_name").notNull(),
		status: text("status").notNull(),
		conclusion: text("conclusion"),
		objectId: text("object_id"),
		objectKey: text("object_key"),
		originalByteLength: integer("original_byte_length"),
		storedByteLength: integer("stored_byte_length"),
		filterVersion: integer("filter_version").notNull(),
		redactionCounts: jsonb("redaction_counts").notNull(),
		truncated: boolean("truncated"),
		unavailableReason: text("unavailable_reason"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.collectionId, table.jobId],
			name: "github_ci_log_receipt_pkey",
		}),
		index("github_ci_log_receipt_job_idx").on(
			table.organizationId,
			table.repositoryId,
			table.workflowRunId,
			table.runAttempt,
			table.jobId,
		),
		check("github_ci_log_receipt_attempt_check", sql`${table.runAttempt} > 0`),
		check(
			"github_ci_log_receipt_sizes_check",
			sql`(${table.originalByteLength} IS NULL OR ${table.originalByteLength} >= 0) AND (${table.storedByteLength} IS NULL OR ${table.storedByteLength} >= 0)`,
		),
		check(
			"github_ci_log_receipt_object_check",
			sql`(${table.objectId} IS NULL) = (${table.objectKey} IS NULL)`,
		),
		check(
			"github_ci_log_receipt_redactions_check",
			sql`jsonb_typeof(${table.redactionCounts}) = 'object'`,
		),
	],
);

export const githubPullRequestSnapshot = pgTable(
	"github_pull_request_snapshot",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		collectionId: text("collection_id")
			.notNull()
			.references(() => githubEvidenceCollection.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id").notNull(),
		provider: text("provider").default("github").notNull(),
		providerPullRequestId: text("provider_pull_request_id").notNull(),
		pullNumber: integer("pull_number").notNull(),
		headSha: text("head_sha").notNull(),
		mergedAt: timestamp("merged_at", { withTimezone: true }),
		sessionId: text("session_id").default("").notNull(),
		sessionSource: text("session_source").default("").notNull(),
		sessionUserId: text("session_user_id").default("").notNull(),
		coverageComplete: boolean("coverage_complete").notNull(),
		ciCoverageComplete: boolean("ci_coverage_complete").notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.collectionId, table.providerPullRequestId],
			name: "github_pull_request_snapshot_pkey",
		}),
		index("github_pull_request_snapshot_dashboard_idx").on(
			table.organizationId,
			table.mergedAt,
			table.repositoryId,
		),
		index("github_pull_request_snapshot_identity_idx").on(
			table.organizationId,
			table.repositoryId,
			table.provider,
			table.providerPullRequestId,
			table.observedAt,
		),
		check(
			"github_pull_request_snapshot_provider_check",
			sql`${table.provider} = 'github'`,
		),
	],
);

/**
 * Durable write-ahead intents for GitHub evidence objects in R2. A row is
 * committed (under a per-key advisory lock) before the object is checked or
 * written and is released when the collection that owns it commits its
 * receipts. There are deliberately no foreign keys: intents must survive
 * organization cascades so the purge job and the orphan sweeper can still
 * find objects that never reached a receipt.
 */
export const githubEvidenceObjectIntent = pgTable(
	"github_evidence_object_intent",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		collectionId: text("collection_id").notNull(),
		objectKey: text("object_key").notNull(),
		dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("github_evidence_object_intent_due_idx").on(table.dueAt),
		index("github_evidence_object_intent_collection_idx").on(
			table.collectionId,
		),
		index("github_evidence_object_intent_key_idx").on(table.objectKey),
		index("github_evidence_object_intent_organization_idx").on(
			table.organizationId,
		),
		check(
			"github_evidence_object_intent_key_check",
			sql`length(btrim(${table.objectKey})) > 0`,
		),
	],
);

/**
 * Durable dedupe ledger for verified GitHub App webhook deliveries that
 * targeted a bound installation or repository. Raw payloads are never stored:
 * a row keeps only the delivery identity, routing identifiers and the outcome
 * of mapping the event onto the evidence collection queue. Deliveries for
 * unbound installations or repositories are dropped without a row.
 */
export const githubWebhookDelivery = pgTable(
	"github_webhook_delivery",
	{
		deliveryId: text("delivery_id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		installationId: text("installation_id").notNull(),
		repositoryId: text("repository_id"),
		event: text("event").notNull(),
		action: text("action").default("").notNull(),
		outcome: text("outcome").notNull(),
		affectedRows: integer("affected_rows").default(0).notNull(),
		receivedAt: timestamp("received_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("github_webhook_delivery_received_idx").on(table.receivedAt),
		index("github_webhook_delivery_organization_idx").on(table.organizationId),
		check(
			"github_webhook_delivery_id_check",
			sql`${table.deliveryId} ~ '^[A-Za-z0-9-]{1,64}$'`,
		),
		check(
			"github_webhook_delivery_outcome_check",
			sql`${table.outcome} IN ('refresh_scheduled', 'installation_updated', 'no_op')`,
		),
		check(
			"github_webhook_delivery_affected_rows_check",
			sql`${table.affectedRows} >= 0`,
		),
	],
);
