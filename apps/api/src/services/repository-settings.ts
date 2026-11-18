import { ORPCError } from "@orpc/server";
import type { RepositorySettings } from "@rudel/api-routes";
import { queryClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	buildRepositorySettings,
	type RepositoryInventory,
	type SavedRepositoryReport,
} from "./repository-settings-model.js";

export async function getRepositorySettings(
	organizationId: string,
	userId: string,
): Promise<RepositorySettings> {
	const [inventory, reports] = await Promise.all([
		// Metadata only: no transcript reads, pricing joins, or dashboard date filter.
		queryClickhouse<RepositoryInventory>({
			query: `SELECT project_path, git_remote, package_name, count() AS session_count
				FROM rudel.session_analytics FINAL
				WHERE source IN ('claude_code', 'codex') AND organization_id = {organizationId:String}
				GROUP BY project_path, git_remote, package_name LIMIT 10001`,
			query_params: { organizationId },
			clickhouse_settings: {
				max_execution_time: 15,
				max_rows_to_read: "10000000",
				max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
				max_memory_usage: String(512 * 1024 * 1024),
				timeout_before_checking_execution_speed: 0,
			},
		}),
		sqlClient<SavedRepositoryReport[]>`
			SELECT installation_id, repositories, reported_at FROM repository_upload_report
			WHERE organization_id = ${organizationId} AND user_id = ${userId}
		`,
	]);
	if (inventory.length > 10000)
		throw new ORPCError("BAD_REQUEST", {
			message: "This workspace has too many repository paths to list.",
		});
	return buildRepositorySettings(inventory, reports);
}
