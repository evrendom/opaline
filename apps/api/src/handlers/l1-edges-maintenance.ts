import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

export const MAINTENANCE_DEADLINE_MS = 270_000;
const L1_PASS_MAX_MS = 240_000;
const CONTEXT_SNAPSHOT_BUDGET_MS = 15_000;
const CONTEXT_SNAPSHOT_OVERRUN_MS = 15_000;
const USAGE_ROLLUP_BUDGET_MS = 15_000;
const USAGE_ROLLUP_OVERRUN_MS = 25_000;

export function planMaintenanceBudgets(elapsedMs: number) {
	const remaining = MAINTENANCE_DEADLINE_MS - elapsedMs;
	const usageRollupReserve = USAGE_ROLLUP_BUDGET_MS + USAGE_ROLLUP_OVERRUN_MS;
	const contextSnapshotReserve =
		CONTEXT_SNAPSHOT_BUDGET_MS + CONTEXT_SNAPSHOT_OVERRUN_MS;
	return {
		contextSnapshotsMs: clamp(
			remaining - usageRollupReserve - CONTEXT_SNAPSHOT_OVERRUN_MS,
			CONTEXT_SNAPSHOT_BUDGET_MS,
		),
		l1PassMs: clamp(
			remaining - contextSnapshotReserve - usageRollupReserve,
			L1_PASS_MAX_MS,
		),
		usageRollupsMs: clamp(
			remaining - USAGE_ROLLUP_OVERRUN_MS,
			USAGE_ROLLUP_BUDGET_MS,
		),
	};
}

function clamp(available: number, maximum: number): number {
	return Math.max(0, Math.min(available, maximum));
}

/** Minute cron: builds due L1 edge scopes within the invocation budget. */
export async function handleL1EdgesMaintenanceRequest(
	request: Request,
): Promise<Response> {
	const startedAt = Date.now();
	const budgets = () => planMaintenanceBudgets(Date.now() - startedAt);
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const idle = await import("../services/idle-activity.js");
	const skipped = idle.idleCronResponse(await idle.cronGate());
	if (skipped) return skipped;
	// Unauthorized probes must not initialize database or provider clients.
	const { isL1EdgeWorkerEnabled, runConfiguredL1EdgePass } = await import(
		"../services/l1-edges/l1-edge-worker.service.js"
	);
	if (!isL1EdgeWorkerEnabled())
		return Response.json({
			l1Edges: { enabled: false },
			ok: true,
			usageRollups: await backfillUsageRollups(budgets().usageRollupsMs),
		});
	const built = await runConfiguredL1EdgePass(budgets().l1PassMs);
	const [{ backfillContextSnapshots }, { getClickhouse }, { sqlClient }] =
		await Promise.all([
			import("../services/context-snapshot-backfill.service.js"),
			import("../clickhouse.js"),
			import("../db.js"),
		]);
	const contextSnapshots = await backfillContextSnapshots({
		budgetMs: budgets().contextSnapshotsMs,
		executor: getClickhouse(),
		sql: sqlClient,
	});
	return Response.json({
		l1Edges: { enabled: true, built },
		contextSnapshots,
		ok: true,
		usageRollups: await backfillUsageRollups(budgets().usageRollupsMs),
	});
}

async function backfillUsageRollups(budgetMs: number) {
	const { isUsageRollupBackfillEnabled } = await import("../lib/env.js");
	if (!isUsageRollupBackfillEnabled()) return { enabled: false };
	if (budgetMs <= 0) return { enabled: true, skipped: "no time left" };
	const [{ backfillUsageSessionRollups }, { getClickhouse }, { sqlClient }] =
		await Promise.all([
			import("../services/usage-session-rollup-backfill.service.js"),
			import("../clickhouse.js"),
			import("../db.js"),
		]);
	const result = await backfillUsageSessionRollups({
		budgetMs,
		executor: getClickhouse(),
		sql: sqlClient,
	}).catch((error: unknown) => ({
		error: error instanceof Error ? error.message : String(error),
	}));
	return { enabled: true, ...result };
}
