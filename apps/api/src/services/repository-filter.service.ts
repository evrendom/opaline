import { resolveRepoIdentity } from "@rudel/api-routes";
import { queryClickhouse } from "../clickhouse.js";

export const REPOSITORY_QUERY_SETTINGS = {
	max_execution_time: 30,
	max_rows_to_read: "10000000",
	max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
	max_result_rows: "10000",
	max_result_bytes: String(32 * 1024 * 1024),
	result_overflow_mode: "throw",
	join_use_nulls: 0,
} as const;

// Resolve with the same identity rules as Sessions, including Conductor worktrees.
// Pass compact, server-computed fingerprints instead of long worktree paths in
// ClickHouse's URL parameters. Both sides hash the exact raw metadata tuple.
const REPOSITORY_FINGERPRINT_SQL =
	"hex(MD5(toJSONString(tuple(sa.git_remote, sa.package_name, sa.project_path))))";

export async function getRepositorySqlFilter(orgId: string, repoKey: string) {
	const rows = await queryClickhouse<{
		git_remote: string;
		package_name: string;
		project_path: string;
		fingerprint: string;
	}>({
		clickhouse_settings: REPOSITORY_QUERY_SETTINGS,
		query: `SELECT DISTINCT sa.git_remote, sa.package_name, sa.project_path,
   ${REPOSITORY_FINGERPRINT_SQL} AS fingerprint
   FROM rudel.session_analytics AS sa FINAL
   WHERE sa.organization_id = {orgId:String}
   LIMIT 10001`,
		query_params: { orgId },
	});
	const fingerprints = rows
		.filter(
			(row) =>
				resolveRepoIdentity({
					gitRemote: row.git_remote,
					packageName: row.package_name,
					projectPath: row.project_path,
				}).repoKey === repoKey,
		)
		.map((row) => row.fingerprint);
	return {
		sql: `${REPOSITORY_FINGERPRINT_SQL} IN {repositoryFingerprints:Array(String)}`,
		params: { repositoryFingerprints: fingerprints },
	};
}
