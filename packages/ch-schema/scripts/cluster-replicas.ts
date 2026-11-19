import type { ClickHouseExecutor } from "@chkit/clickhouse";

const DENIED = /privilege|ACCESS_DENIED/u;

/**
 * The replicas of the `default` cluster, so a migration's read-back checks
 * each one; 1 for a single server. Production's migration identity may not
 * read `system.clusters`; the replicas then answer for themselves through
 * `clusterAllReplicas`, which fails if one is unavailable. If neither can be
 * read, this refuses: the endpoint is load balanced, so separate reads of it
 * may reach different replicas, and checking only the one reached could
 * journal a schema a lagging replica does not serve yet.
 */
export async function countReplicas(
	executor: ClickHouseExecutor,
	checking: string,
): Promise<number> {
	try {
		const [row] = await executor.query<{ replicas: number | string }>(
			"SELECT count() AS replicas FROM system.clusters WHERE cluster = 'default' SETTINGS max_execution_time = 10",
		);
		return Math.max(1, Number(row?.replicas ?? 0));
	} catch (error) {
		if (!(error instanceof Error) || !DENIED.test(error.message)) throw error;
	}
	try {
		const [row] = await executor.query<{ replicas: number | string }>(
			"SELECT uniqExact(hostName()) AS replicas FROM clusterAllReplicas('default', system.one) SETTINGS max_execution_time = 10, skip_unavailable_shards = 0",
		);
		const replicas = Number(row?.replicas ?? 0);
		if (Number.isSafeInteger(replicas) && replicas > 0) return replicas;
		throw new Error("no replica answered");
	} catch (error) {
		throw new Error(
			`Cannot list the cluster's replicas to check each one serves ${checking}; grant SELECT on system.clusters or REMOTE to the migration user (${error instanceof Error ? error.message : String(error)})`,
		);
	}
}
