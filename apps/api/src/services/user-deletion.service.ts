import type postgres from "postgres";
import { cancelOrganizationBillingSubscription } from "./billing.service.js";
import {
	deleteSnapshottedRepositoryEvidenceObjects,
	enqueueClickHousePurge,
	wakeClickHousePurgeWorker,
} from "./clickhouse-purge.service.js";

export interface DeletedUserPostgresData {
	deletedOrganizationIds: string[];
}

interface DeleteUserPostgresDataEnv {
	sqlClient: postgres.Sql;
}

export class AccountDeletionBlockedError extends Error {
	constructor() {
		super(
			"Delete or transfer ownership of workspaces with other members before deleting your account",
		);
		this.name = "AccountDeletionBlockedError";
	}
}

export async function deleteUserPostgresData(
	userId: string,
	env: DeleteUserPostgresDataEnv,
): Promise<DeletedUserPostgresData> {
	const deletedData = await env.sqlClient.begin(async (transaction) => {
		await transaction.unsafe(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`, [
			userId,
		]);
		await lockOwnedOrganizations(userId, transaction);
		if (await ownsOrganizationWithOtherMembers(userId, transaction)) {
			throw new AccountDeletionBlockedError();
		}
		const candidateOrganizationIds = await readSingleMemberOrganizations(
			userId,
			transaction,
		);
		for (const organizationId of candidateOrganizationIds) {
			await cancelOrganizationBillingSubscription(organizationId);
		}
		await enqueueClickHousePurge(
			{ targetId: userId, targetType: "account" },
			transaction,
		);
		await transaction.unsafe(
			`UPDATE github_evidence_collection
			 SET session_user_id = '', session_source = '',
			     session_id = CASE WHEN session_id = '' THEN '' ELSE id END, context_id = '',
			     status = CASE WHEN status IN ('queued', 'collecting', 'failed') THEN 'cancelled' ELSE status END,
			     lease_expires_at = NULL, retry_after = NULL, refresh_due_at = NULL, updated_at = NOW()
			 WHERE session_user_id = $1 OR (session_id <> '' AND initiated_by_user_id = $1)`,
			[userId],
		);
		await transaction.unsafe(
			"UPDATE github_pull_request_snapshot SET session_user_id = '', session_source = '', session_id = '' WHERE session_user_id = $1",
			[userId],
		);
		const confirmedOrganizationIds =
			candidateOrganizationIds.length === 0
				? []
				: (
						await transaction.unsafe<Array<{ id: string }>>(
							`SELECT id
							FROM organization
							WHERE id = ANY($1::text[])
								AND NOT EXISTS (
									SELECT 1 FROM member
									WHERE member.organization_id = organization.id
										AND member.user_id <> $2
								)
							ORDER BY id`,
							[candidateOrganizationIds, userId],
						)
					).map((organization) => organization.id);
		// Enqueue each purge before the delete so the job snapshots the
		// organization's repository evidence objects before foreign keys cascade.
		for (const organizationId of confirmedOrganizationIds) {
			await enqueueClickHousePurge(
				{ targetId: organizationId, targetType: "organization" },
				transaction,
			);
		}
		const deletedOrganizations =
			confirmedOrganizationIds.length === 0
				? []
				: await transaction.unsafe<Array<{ id: string }>>(
						`DELETE FROM organization
						WHERE id = ANY($1::text[])
						RETURNING id`,
						[confirmedOrganizationIds],
					);
		const deletedOrganizationIds = deletedOrganizations.map(
			(organization) => organization.id,
		);
		await transaction.unsafe("DELETE FROM apikey WHERE reference_id = $1", [
			userId,
		]);
		if (deletedOrganizationIds.length > 0) {
			await transaction.unsafe(
				`UPDATE session SET active_organization_id = NULL
				WHERE active_organization_id = ANY($1::text[])`,
				[deletedOrganizationIds],
			);
		}
		await transaction.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
		await deleteSnapshottedRepositoryEvidenceObjects(userId, transaction);

		return { deletedOrganizationIds };
	});
	await wakeClickHousePurgeWorker();
	return deletedData;
}

async function readSingleMemberOrganizations(
	userId: string,
	database: postgres.Sql | postgres.TransactionSql,
): Promise<string[]> {
	const rows = await database.unsafe<Array<{ id: string }>>(
		`SELECT organization.id
		FROM organization
		INNER JOIN member ON member.organization_id = organization.id
		WHERE member.user_id = $1
			AND NOT EXISTS (
				SELECT 1 FROM member other_member
				WHERE other_member.organization_id = organization.id
					AND other_member.user_id <> $1
			)
		ORDER BY organization.id`,
		[userId],
	);
	return rows.map((row) => row.id);
}

async function lockOwnedOrganizations(
	userId: string,
	transaction: postgres.TransactionSql,
): Promise<void> {
	await transaction.unsafe(
		`SELECT organization.id
		FROM organization
		INNER JOIN member owner ON owner.organization_id = organization.id
		WHERE owner.user_id = $1 AND owner.role = 'owner'
		ORDER BY organization.id
		FOR UPDATE OF organization`,
		[userId],
	);
}

async function ownsOrganizationWithOtherMembers(
	userId: string,
	transaction: postgres.TransactionSql,
): Promise<boolean> {
	const [organization] = await transaction.unsafe<Array<{ id: string }>>(
		`SELECT owner.organization_id AS id
		FROM member owner
		WHERE owner.user_id = $1 AND owner.role = 'owner'
			AND EXISTS (
				SELECT 1 FROM member other_member
				WHERE other_member.organization_id = owner.organization_id
					AND other_member.user_id <> $1
			)
		LIMIT 1`,
		[userId],
	);
	return organization !== undefined;
}
