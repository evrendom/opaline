import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { sqlClient } from "../db.js";
import { deleteUserPostgresData } from "../services/user-deletion.service.js";

const TEST_RUN_ID = `repository_evidence_deletion_${Date.now()}_${crypto.randomUUID()}`;
const USER_IDS: string[] = [];
const ORGANIZATION_IDS: string[] = [];

setDefaultTimeout(120_000);

afterEach(async () => {
	if (ORGANIZATION_IDS.length > 0) {
		await sqlClient.unsafe(
			"DELETE FROM organization WHERE id = ANY($1::text[])",
			[ORGANIZATION_IDS.splice(0)],
		);
	}
	if (USER_IDS.length > 0) {
		const userIds = USER_IDS.splice(0);
		await sqlClient.unsafe(
			"DELETE FROM clickhouse_purge_job WHERE target_id = ANY($1::text[])",
			[userIds],
		);
		await sqlClient.unsafe('DELETE FROM "user" WHERE id = ANY($1::text[])', [
			userIds,
		]);
	}
});

describe("repository evidence account deletion", () => {
	test("purges only the departing member and later allows workspace deletion", async () => {
		const victimId = `${TEST_RUN_ID}_victim`;
		const survivorId = `${TEST_RUN_ID}_survivor`;
		const organizationId = `${TEST_RUN_ID}_organization`;
		const exclusiveObjectId = `sha256:${"a".repeat(64)}`;
		const sharedObjectId = `sha256:${"b".repeat(64)}`;
		const exclusiveObjectKey = `repository-evidence/${organizationId}/${"a".repeat(64)}`;
		const sharedObjectKey = `repository-evidence/${organizationId}/${"b".repeat(64)}`;
		USER_IDS.push(victimId, survivorId);
		ORGANIZATION_IDS.push(organizationId);

		await sqlClient.unsafe(
			`INSERT INTO "user" (id, name, email, email_verified)
			 VALUES ($1, 'Victim', $2, false), ($3, 'Survivor', $4, false)`,
			[
				victimId,
				`${victimId}@example.com`,
				survivorId,
				`${survivorId}@example.com`,
			],
		);
		await sqlClient.unsafe(
			`INSERT INTO organization (id, name, slug)
			 VALUES ($1, 'Shared workspace', $2)`,
			[organizationId, organizationId],
		);
		await sqlClient.unsafe(
			`INSERT INTO member (id, organization_id, user_id, role)
			 VALUES ($1, $2, $3, 'member'), ($4, $2, $5, 'owner')`,
			[
				`${TEST_RUN_ID}_victim_member`,
				organizationId,
				victimId,
				`${TEST_RUN_ID}_survivor_member`,
				survivorId,
			],
		);
		await sqlClient.unsafe(
			`INSERT INTO github_app_installation (
				installation_id, organization_id, account_id, account_login,
				account_type, repository_selection, permissions, installed_by_user_id
			 ) VALUES ($1, $2, 'github-account', 'opaline-test', 'Organization', 'all', '{}'::jsonb, $3)`,
			[`${TEST_RUN_ID}_installation`, organizationId, victimId],
		);
		await sqlClient.unsafe(
			`INSERT INTO repository_evidence_object (
				organization_id, object_id, object_key, kind, byte_length,
				media_type, content_encoding, filter_version, status, available_at
			 ) VALUES
				($1, $2, $3, 'source-blob', 1, 'text/plain', 'identity', 1, 'available', NOW()),
				($1, $4, $5, 'source-blob', 1, 'text/plain', 'identity', 1, 'available', NOW())`,
			[
				organizationId,
				exclusiveObjectId,
				exclusiveObjectKey,
				sharedObjectId,
				sharedObjectKey,
			],
		);
		await insertUpload({
			objectIds: [exclusiveObjectId, sharedObjectId],
			organizationId,
			uploadId: `${TEST_RUN_ID}_victim_upload`,
			userId: victimId,
		});
		await insertUpload({
			objectIds: [sharedObjectId],
			organizationId,
			uploadId: `${TEST_RUN_ID}_survivor_upload`,
			userId: survivorId,
		});
		const victimUploadId = `${TEST_RUN_ID}_victim_upload`;
		await sqlClient.unsafe(
			`UPDATE repository_evidence_upload
			 SET status = 'committed', receipt_id = $2, committed_at = NOW()
			 WHERE id = $1`,
			[victimUploadId, `${TEST_RUN_ID}_receipt`],
		);
		await sqlClient.unsafe(
			`INSERT INTO repository_evidence_capture (
				organization_id, context_id, user_id, upload_id, manifest_object_id,
				installation_id, local_repository_id, local_worktree_id, session_id,
				run_id, segment_id, source, lifecycle, captured_at, coverage
			 ) VALUES (
				$1, $2, $3, $4, $5, $6, 'local-repository', 'local-worktree',
				'session', 'run', 'segment', 'codex', 'end', NOW(), '[]'::jsonb
			 )`,
			[
				organizationId,
				`${TEST_RUN_ID}_context`,
				victimId,
				victimUploadId,
				exclusiveObjectId,
				`${TEST_RUN_ID}_installation`,
			],
		);

		const result = await deleteUserPostgresData(victimId, { sqlClient });

		expect(result.deletedOrganizationIds).toEqual([]);
		const [victim] = await sqlClient<Array<{ id: string }>>`
			SELECT id FROM "user" WHERE id = ${victimId}
		`;
		expect(victim).toBeUndefined();
		const [victimCapture] = await sqlClient<Array<{ contextId: string }>>`
			SELECT context_id AS "contextId"
			FROM repository_evidence_capture
			WHERE organization_id = ${organizationId}
				AND user_id = ${victimId}
		`;
		expect(victimCapture).toBeUndefined();
		const [organization] = await sqlClient<Array<{ id: string }>>`
			SELECT id FROM organization WHERE id = ${organizationId}
		`;
		expect(organization?.id).toBe(organizationId);
		const [installation] = await sqlClient<
			Array<{ installedByUserId: string | null }>
		>`
			SELECT installed_by_user_id AS "installedByUserId"
			FROM github_app_installation
			WHERE installation_id = ${`${TEST_RUN_ID}_installation`}
		`;
		expect(installation?.installedByUserId).toBeNull();
		const objects = await sqlClient<Array<{ objectId: string }>>`
			SELECT object_id AS "objectId"
			FROM repository_evidence_object
			WHERE organization_id = ${organizationId}
			ORDER BY object_id
		`;
		expect([...objects]).toEqual([{ objectId: sharedObjectId }]);
		const references = await sqlClient<
			Array<{ objectId: string; uploadId: string }>
		>`
			SELECT object_id AS "objectId", upload_id AS "uploadId"
			FROM repository_evidence_upload_object
			WHERE organization_id = ${organizationId}
		`;
		expect([...references]).toEqual([
			{
				objectId: sharedObjectId,
				uploadId: `${TEST_RUN_ID}_survivor_upload`,
			},
		]);
		const queuedObjects = await sqlClient<Array<{ objectKey: string }>>`
			SELECT purge_object.object_key AS "objectKey"
			FROM clickhouse_purge_job purge_job
			INNER JOIN clickhouse_purge_object purge_object
				ON purge_object.purge_job_id = purge_job.id
			WHERE purge_job.target_type = 'account'
				AND purge_job.target_id = ${victimId}
			ORDER BY purge_object.object_key
		`;
		expect([...queuedObjects]).toEqual([{ objectKey: exclusiveObjectKey }]);

		const survivorUploadId = `${TEST_RUN_ID}_survivor_upload`;
		await sqlClient.unsafe(
			`UPDATE repository_evidence_upload
			 SET status = 'committed', receipt_id = $2, committed_at = NOW()
			 WHERE id = $1`,
			[survivorUploadId, `${TEST_RUN_ID}_survivor_receipt`],
		);
		await sqlClient.unsafe(
			`INSERT INTO repository_evidence_capture (
				organization_id, context_id, user_id, upload_id, manifest_object_id,
				installation_id, local_repository_id, local_worktree_id, session_id,
				run_id, segment_id, source, lifecycle, captured_at, coverage
			 ) VALUES (
				$1, $2, $3, $4, $5, $6, 'local-repository', 'local-worktree',
				'session', 'run', 'segment', 'codex', 'end', NOW(), '[]'::jsonb
			 )`,
			[
				organizationId,
				`${TEST_RUN_ID}_survivor_context`,
				survivorId,
				survivorUploadId,
				sharedObjectId,
				`${TEST_RUN_ID}_installation`,
			],
		);

		await sqlClient`DELETE FROM organization WHERE id = ${organizationId}`;
		const organizationRows = await sqlClient<
			Array<{ count: number; tableName: string }>
		>`
			SELECT 'github_app_installation' AS "tableName", COUNT(*)::int AS count
			FROM github_app_installation WHERE organization_id = ${organizationId}
			UNION ALL
			SELECT 'repository_evidence_capture', COUNT(*)::int
			FROM repository_evidence_capture WHERE organization_id = ${organizationId}
			UNION ALL
			SELECT 'repository_evidence_object', COUNT(*)::int
			FROM repository_evidence_object WHERE organization_id = ${organizationId}
			UNION ALL
			SELECT 'repository_evidence_upload', COUNT(*)::int
			FROM repository_evidence_upload WHERE organization_id = ${organizationId}
			UNION ALL
			SELECT 'repository_evidence_upload_object', COUNT(*)::int
			FROM repository_evidence_upload_object WHERE organization_id = ${organizationId}
			ORDER BY "tableName"
		`;
		expect([...organizationRows]).toEqual([
			{ count: 0, tableName: "github_app_installation" },
			{ count: 0, tableName: "repository_evidence_capture" },
			{ count: 0, tableName: "repository_evidence_object" },
			{ count: 0, tableName: "repository_evidence_upload" },
			{ count: 0, tableName: "repository_evidence_upload_object" },
		]);
		const [survivor] = await sqlClient<Array<{ id: string }>>`
			SELECT id FROM "user" WHERE id = ${survivorId}
		`;
		expect(survivor?.id).toBe(survivorId);
	});
});

async function insertUpload(input: {
	objectIds: string[];
	organizationId: string;
	uploadId: string;
	userId: string;
}): Promise<void> {
	const manifestObjectId = input.objectIds[0];
	if (!manifestObjectId) throw new Error("An upload requires an object");
	await sqlClient.unsafe(
		`INSERT INTO repository_evidence_upload (
			id, operation_id, organization_id, user_id, context_id,
			manifest_object_id, request, missing_object_ids, expires_at
		 ) VALUES ($1, $1, $2, $3, $1, $4, $5::jsonb, '[]'::jsonb, NOW() + INTERVAL '1 hour')`,
		[
			input.uploadId,
			input.organizationId,
			input.userId,
			manifestObjectId,
			JSON.stringify({
				input: {
					objects: input.objectIds.map((objectId) => ({ objectId })),
				},
			}),
		],
	);
	for (const objectId of input.objectIds) {
		await sqlClient.unsafe(
			`INSERT INTO repository_evidence_upload_object (
				upload_id, organization_id, object_id
			 ) VALUES ($1, $2, $3)`,
			[input.uploadId, input.organizationId, objectId],
		);
	}
}
