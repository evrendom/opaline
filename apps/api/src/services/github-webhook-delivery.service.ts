import type postgres from "postgres";
import {
	persistGitHubChecks,
	persistGitHubPullRequests,
	persistGitHubRuns,
	persistGitHubStatuses,
} from "./github-outcomes-persistence.service.js";
import { refreshPrTotalsReadiness } from "./github-outcomes-readiness.service.js";
import { enqueueGitHubRepositorySweep } from "./github-repository-sweep.service.js";
import type { GitHubWebhookIntent } from "./github-webhook-events.js";

/**
 * A burst of events for one commit (check suites, workflow runs and statuses
 * settle within seconds of each other) coalesces into one refresh.
 */
export const GITHUB_WEBHOOK_REFRESH_DEBOUNCE_MS = 30_000;
const DELIVERY_RETENTION_DAYS = 30;
const PRUNE_BATCH_SIZE = 1_000;

export type GitHubWebhookDeliveryOutcome =
	| "installation_updated"
	| "no_op"
	| "refresh_scheduled";

export type GitHubWebhookDeliveryResult =
	/** No bound installation or repository: nothing was stored. */
	| { readonly status: "dropped" }
	| { readonly status: "duplicate" }
	| {
			readonly status: "recorded";
			readonly outcome: GitHubWebhookDeliveryOutcome;
			readonly affectedRows: number;
			readonly collectionIds: readonly string[];
			readonly refreshDueAt: Date | null;
	  };

type Transaction = postgres.TransactionSql;

/**
 * Claims the delivery in Postgres, acknowledging versioned ClickHouse facts
 * before committing delivery progress. A crash replays facts idempotently.
 * Tenancy always comes from
 * Opaline's own installation and binding rows: the payload only contributes
 * numeric GitHub identifiers, which must match an active binding of the same
 * installation.
 */
export async function recordGitHubWebhookDelivery(input: {
	readonly action: string;
	readonly database: postgres.Sql;
	readonly deliveryId: string;
	readonly event: string;
	readonly intent: GitHubWebhookIntent;
	readonly now?: () => Date;
}): Promise<GitHubWebhookDeliveryResult> {
	const now = (input.now ?? (() => new Date()))();
	return input.database.begin(async (transaction) => {
		// Webhook acknowledgement must stay well inside GitHub's 10 s timeout.
		await transaction.unsafe("SET LOCAL statement_timeout = '5s'");
		await transaction.unsafe("SET LOCAL lock_timeout = '2s'");
		const organizationId = await resolveOrganization(transaction, input.intent);
		if (!organizationId) return { status: "dropped" as const };
		const claimed = await transaction.unsafe<Array<{ delivery_id: string }>>(
			`INSERT INTO github_webhook_delivery
			 (delivery_id, organization_id, installation_id, repository_id, event, action, outcome, affected_rows, received_at)
			 VALUES ($1, $2, $3, $4, $5, $6, 'no_op', 0, $7)
			 ON CONFLICT (delivery_id) DO NOTHING
			 RETURNING delivery_id`,
			[
				input.deliveryId,
				organizationId,
				input.intent.installationId,
				input.intent.kind === "refresh" ? input.intent.repositoryId : null,
				input.event,
				input.action,
				now.toISOString(),
			],
		);
		if (claimed.length === 0) return { status: "duplicate" as const };
		const applied = await applyIntent(
			transaction,
			organizationId,
			input.intent,
			now,
		);
		await refreshPrTotalsReadiness(transaction, organizationId, now);
		await transaction.unsafe(
			"UPDATE github_webhook_delivery SET outcome = $2, affected_rows = $3 WHERE delivery_id = $1",
			[input.deliveryId, applied.outcome, applied.affectedRows],
		);
		return { status: "recorded" as const, ...applied };
	});
}

export async function pruneGitHubWebhookDeliveries(input: {
	readonly database: postgres.Sql;
	readonly now?: () => Date;
}): Promise<number> {
	const now = (input.now ?? (() => new Date()))();
	const deleted = await input.database.unsafe<Array<{ delivery_id: string }>>(
		`DELETE FROM github_webhook_delivery
		 WHERE delivery_id IN (
		   SELECT delivery_id FROM github_webhook_delivery
		   WHERE received_at < $1::timestamptz - make_interval(days => $2)
		   ORDER BY received_at
		   LIMIT $3
		 )
		 RETURNING delivery_id`,
		[now.toISOString(), DELIVERY_RETENTION_DAYS, PRUNE_BATCH_SIZE],
	);
	return deleted.length;
}

async function resolveOrganization(
	transaction: Transaction,
	intent: GitHubWebhookIntent,
): Promise<string | null> {
	if (intent.kind === "refresh") {
		const rows = await transaction.unsafe<Array<{ organization_id: string }>>(
			`SELECT binding.organization_id
			 FROM github_repository_binding binding
			 INNER JOIN github_app_installation installation
			   ON installation.installation_id = binding.installation_id
			  AND installation.organization_id = binding.organization_id
			 WHERE binding.installation_id = $1
			   AND binding.repository_id = $2
			   AND binding.status = 'active'
			   AND installation.status = 'active'
			 LIMIT 1 FOR SHARE OF binding, installation`,
			[intent.installationId, intent.repositoryId],
		);
		return rows[0]?.organization_id ?? null;
	}
	// Serialize with the setup flow, which rebinds under the same lock.
	await transaction.unsafe(
		"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
		[`github-installation-id:${intent.installationId}`],
	);
	const rows = await transaction.unsafe<Array<{ organization_id: string }>>(
		"SELECT organization_id FROM github_app_installation WHERE installation_id = $1 FOR UPDATE",
		[intent.installationId],
	);
	return rows[0]?.organization_id ?? null;
}

async function applyIntent(
	transaction: Transaction,
	organizationId: string,
	intent: GitHubWebhookIntent,
	now: Date,
): Promise<{
	readonly outcome: GitHubWebhookDeliveryOutcome;
	readonly affectedRows: number;
	readonly collectionIds: readonly string[];
	readonly refreshDueAt: Date | null;
}> {
	switch (intent.kind) {
		case "refresh": {
			if (intent.outcome) {
				const scope = { organizationId, repositoryId: intent.repositoryId };
				switch (intent.outcome.kind) {
					case "pull_request":
						await persistGitHubPullRequests(
							scope,
							[intent.outcome.data],
							"webhook",
							now,
							transaction,
						);
						break;
					case "actions_run":
						await persistGitHubRuns(
							scope,
							[intent.outcome.data],
							"webhook",
							now,
							transaction,
						);
						break;
					case "check_suite":
						await persistGitHubChecks(
							scope,
							[intent.outcome.data],
							"check_suite",
							"webhook",
							now,
							transaction,
						);
						break;
					case "status":
						await persistGitHubStatuses(
							scope,
							[intent.outcome.data],
							intent.commitShas[0] ?? "",
							"webhook",
							now,
							transaction,
						);
						break;
				}
			}
			const refreshDueAt = new Date(
				now.getTime() + GITHUB_WEBHOOK_REFRESH_DEBOUNCE_MS,
			);
			const collectionIds =
				intent.refreshSessionEvidence === false
					? []
					: await scheduleRefresh(transaction, {
							commitShas: intent.commitShas,
							now,
							organizationId,
							pullRequestIds: intent.pullRequestIds,
							refreshDueAt,
							repositoryId: intent.repositoryId,
						});
			const affectedRows = collectionIds.length + (intent.outcome ? 1 : 0);
			return affectedRows > 0
				? {
						outcome: "refresh_scheduled",
						affectedRows,
						collectionIds,
						refreshDueAt,
					}
				: { outcome: "no_op", affectedRows, collectionIds, refreshDueAt: null };
		}
		case "installation":
			return installationOutcome(
				await applyInstallationChange(transaction, {
					change: intent.change,
					installationId: intent.installationId,
					now,
					organizationId,
				}),
			);
		case "installation_permissions": {
			const updated = await transaction.unsafe(
				`UPDATE github_app_installation
				 SET permissions = $2::text::jsonb, updated_at = $3
				 WHERE installation_id = $1 AND status <> 'deleted'
				   AND permissions IS DISTINCT FROM $2::text::jsonb
				 RETURNING installation_id`,
				[
					intent.installationId,
					JSON.stringify(intent.permissions),
					now.toISOString(),
				],
			);
			return installationOutcome(updated.length);
		}
		case "repositories_removed": {
			const removed = await transaction.unsafe(
				`UPDATE github_repository_binding SET status = 'removed', updated_at = $4
				 WHERE organization_id = $1 AND installation_id = $2
				   AND repository_id = ANY($3::text[]) AND status = 'active'
				 RETURNING repository_id`,
				[
					organizationId,
					intent.installationId,
					intent.repositoryIds,
					now.toISOString(),
				],
			);
			return installationOutcome(removed.length);
		}
	}
}

function installationOutcome(affectedRows: number) {
	return {
		affectedRows,
		collectionIds: [],
		outcome:
			affectedRows > 0 ? ("installation_updated" as const) : ("no_op" as const),
		refreshDueAt: null,
	};
}

/**
 * Pulls the next refresh of every session-linked collection for the commits
 * or pull requests forward. Only the latest attempt of each collection
 * identity inside the 14-day observation window is touched, exactly the rows
 * the maintenance pass would refresh anyway; queued attempts are skipped
 * because they have not collected yet. A refresh requested while an attempt is
 * collecting survives its completion.
 */
async function scheduleRefresh(
	transaction: Transaction,
	input: {
		readonly commitShas: readonly string[];
		readonly now: Date;
		readonly organizationId: string;
		readonly pullRequestIds: readonly string[];
		readonly refreshDueAt: Date;
		readonly repositoryId: string;
	},
): Promise<readonly string[]> {
	const rows = await transaction.unsafe<Array<{ id: string }>>(
		`WITH linked AS (
		   SELECT DISTINCT collection.commit_sha, collection.session_id, collection.context_id
		   FROM github_evidence_collection collection
		   WHERE collection.organization_id = $1
		     AND collection.repository_id = $2
		     AND collection.observation_started_at > $5::timestamptz - INTERVAL '14 days'
		     AND (
		       collection.commit_sha = ANY($3::text[])
		       OR EXISTS (
		         SELECT 1 FROM github_pull_request_snapshot snapshot
		         WHERE snapshot.collection_id = collection.id
		           AND snapshot.provider_pull_request_id = ANY($4::text[])
		       )
		     )
		 ), latest AS (
		   SELECT DISTINCT ON (collection.commit_sha, collection.session_id, collection.context_id)
		     collection.id, collection.status
		   FROM github_evidence_collection collection
		   INNER JOIN linked USING (commit_sha, session_id, context_id)
		   WHERE collection.organization_id = $1 AND collection.repository_id = $2
		   ORDER BY collection.commit_sha, collection.session_id, collection.context_id,
		     collection.attempt_number DESC
		 )
		 UPDATE github_evidence_collection collection
		 SET refresh_due_at = LEAST(collection.refresh_due_at, $6::timestamptz)
		 FROM latest
		 WHERE collection.id = latest.id
		   AND collection.status IN ('collecting', 'complete', 'partial', 'failed')
		   AND collection.session_user_id <> ''
		   AND collection.observation_started_at > $5::timestamptz - INTERVAL '14 days'
		 RETURNING collection.id`,
		[
			input.organizationId,
			input.repositoryId,
			input.commitShas,
			input.pullRequestIds,
			input.now.toISOString(),
			input.refreshDueAt.toISOString(),
		],
	);
	return rows.map(({ id }) => id);
}

export async function applyInstallationChange(
	transaction: Transaction,
	input: {
		readonly change: "deleted" | "suspended" | "unsuspended";
		readonly installationId: string;
		readonly now: Date;
		readonly organizationId: string;
	},
): Promise<number> {
	const [status, fromStatuses] =
		input.change === "deleted"
			? ["deleted", ["active", "suspended"]]
			: input.change === "suspended"
				? ["suspended", ["active"]]
				: ["active", ["suspended"]];
	const updated = await transaction.unsafe(
		`UPDATE github_app_installation SET status = $2, updated_at = $4
		 WHERE installation_id = $1 AND status = ANY($3::text[]) AND organization_id = $5
		 RETURNING installation_id`,
		[
			input.installationId,
			status,
			fromStatuses,
			input.now.toISOString(),
			input.organizationId,
		],
	);
	if (input.change === "unsuspended") {
		const bindings = await transaction.unsafe<Array<{ repository_id: string }>>(
			`SELECT repository_id FROM github_repository_binding WHERE organization_id = $1 AND installation_id = $2 AND status = 'active'`,
			[input.organizationId, input.installationId],
		);
		for (const binding of bindings)
			await enqueueGitHubRepositorySweep(
				{
					organizationId: input.organizationId,
					repositoryId: binding.repository_id,
				},
				input.now,
				transaction,
				true,
			);
	}
	if (input.change !== "deleted") return updated.length;
	const removed = await transaction.unsafe(
		`UPDATE github_repository_binding SET status = 'removed', updated_at = $3
		 WHERE organization_id = $1 AND installation_id = $2 AND status = 'active'
		 RETURNING repository_id`,
		[input.organizationId, input.installationId, input.now.toISOString()],
	);
	return updated.length + removed.length;
}
