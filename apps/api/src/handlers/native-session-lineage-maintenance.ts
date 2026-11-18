import { getLogger } from "@logtape/logtape";
import {
	createMaintenanceQueueDeadline,
	drainMaintenancePasses,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";

const logger = getLogger([
	"rudel",
	"api",
	"native-session-lineage-maintenance",
]);
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 25;
const MAX_PASSES = 50;
// Discovery queries may legally consume their full 10-second ClickHouse
// timeout. Leave enough bounded time afterward to persist candidates and
// project their relationships, plus a platform margin for logging/response.
const INVOCATION_BUDGET_MS = 50_000;
const NATIVE_LINEAGE_BUDGET_MS = 45_000;

export async function handleNativeSessionLineageMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const result = await runNativeSessionLineageMaintenance({
			deadlineAt: Date.now() + INVOCATION_BUDGET_MS,
			now: Date.now,
		});
		return Response.json({ nativeSessionLineage: result, ok: true });
	} catch (error) {
		logger.error("Native session lineage maintenance failed: {error}", {
			error: String(error),
		});
		return Response.json(
			{ error: "Native session lineage maintenance failed" },
			{ status: 500 },
		);
	}
}

export async function runNativeSessionLineageMaintenance(
	invocationDeadline: MaintenanceDeadline,
) {
	const [
		{ repairNativeSessionLineagePass },
		{ runNativeMetadataDiscoveryPass },
	] = await Promise.all([
		import("../services/session-native-lineage.service.js"),
		import("../services/session-native-metadata-discovery.service.js"),
	]);
	const deadline = createMaintenanceQueueDeadline(
		invocationDeadline,
		NATIVE_LINEAGE_BUDGET_MS,
	);
	const batchSize = Math.min(
		readPositiveSafeIntegerEnv(
			"SESSION_LINEAGE_RECONCILE_BATCH_SIZE",
			DEFAULT_BATCH_SIZE,
		),
		MAX_BATCH_SIZE,
	);
	const drain = await drainMaintenancePasses({
		deadline,
		maxIterations: MAX_PASSES,
		onIncomplete: (incomplete) => {
			logger.warn(
				"Native session lineage maintenance left queued work after {iterations} passes ({stopReason}); the next cron will continue",
				{
					iterations: incomplete.iterations,
					stopReason: incomplete.stopReason,
				},
			);
		},
		runPass: async () => {
			const discovery = await runNativeMetadataDiscoveryPass(
				batchSize,
				deadline,
			);
			const projection = await repairNativeSessionLineagePass(
				batchSize,
				deadline,
			);
			return {
				discovered: discovery.discovered,
				hasMore: discovery.hasMore || projection.hasMore,
				missing: discovery.missing,
				nativeChildren: discovery.nativeChildren,
				projected: discovery.projected,
				readFailed: discovery.readFailed,
				repaired: projection.repaired,
				rejected: discovery.rejected,
				scanned: discovery.scanned,
				skipped: discovery.skipped,
			};
		},
	});
	const result = {
		discovered: drain.results.reduce(
			(total, result) => total + result.discovered,
			0,
		),
		hasMore: drain.hasMore,
		iterations: drain.iterations,
		missing: drain.results.reduce((total, result) => total + result.missing, 0),
		nativeChildren: drain.results.reduce(
			(total, result) => total + result.nativeChildren,
			0,
		),
		projected: drain.results.reduce(
			(total, result) => total + result.projected,
			0,
		),
		readFailed: drain.results.reduce(
			(total, result) => total + result.readFailed,
			0,
		),
		repaired: drain.results.reduce(
			(total, result) => total + result.repaired,
			0,
		),
		rejected: drain.results.reduce(
			(total, result) => total + result.rejected,
			0,
		),
		scanned: drain.results.reduce((total, result) => total + result.scanned, 0),
		skipped: drain.results.reduce((total, result) => total + result.skipped, 0),
		stopReason: drain.stopReason,
	};
	logger.info(
		"Native session lineage maintenance completed: scanned={scanned}, nativeChildren={nativeChildren}, projected={projected}, repaired={repaired}, missing={missing}, readFailed={readFailed}, rejected={rejected}, skipped={skipped}, hasMore={hasMore}",
		result,
	);
	return result;
}
