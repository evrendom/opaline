import { sqlClient } from "../db.js";
import { cancelOrganizationBillingSubscription } from "./billing.service.js";
import {
	enqueueClickHousePurge,
	wakeClickHousePurgeWorker,
} from "./clickhouse-purge.service.js";

export class OrganizationDeletionForbiddenError extends Error {
	constructor() {
		super("Only the organization owner can delete it");
		this.name = "OrganizationDeletionForbiddenError";
	}
}

export async function deleteOrganizationPostgresData(input: {
	organizationId: string;
	userId: string;
}): Promise<void> {
	await sqlClient.begin(async (transaction) => {
		await transaction.unsafe(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`, [
			input.userId,
		]);
		const [lockedOwnership] = await transaction.unsafe<Array<{ id: string }>>(
			`SELECT organization.id
			FROM organization
			INNER JOIN member ON member.organization_id = organization.id
			WHERE organization.id = $1 AND member.user_id = $2
				AND member.role = 'owner'
			FOR UPDATE OF organization`,
			[input.organizationId, input.userId],
		);
		if (!lockedOwnership) throw new OrganizationDeletionForbiddenError();
		await cancelOrganizationBillingSubscription(input.organizationId);
		await enqueueClickHousePurge(
			{ targetId: input.organizationId, targetType: "organization" },
			transaction,
		);
		await transaction.unsafe("DELETE FROM organization WHERE id = $1", [
			input.organizationId,
		]);
		await transaction.unsafe(
			`UPDATE session SET active_organization_id = NULL
			WHERE active_organization_id = $1`,
			[input.organizationId],
		);
	});
	await wakeClickHousePurgeWorker();
}
