import { getLogger } from "@logtape/logtape";
import {
	drainMaintenancePasses,
	type MaintenanceDrainResult,
	type MaintenancePassResult,
} from "../lib/bounded-maintenance.js";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";
import { readResendConfig } from "../resend-config.js";
import { runClickHousePurgeWorkerPass } from "../services/clickhouse-purge.service.js";
import { runR2IngestRepairPass } from "../services/r2-ingest-repair.service.js";
import {
	createR2MultipartUploadClient,
	readR2IngestAvailability,
} from "../services/r2-ingest-storage.service.js";
import { reconcileSessionLanguageSignalsUntilCaughtUp } from "../services/session-language-signal-reconciliation.service.js";

const logger = getLogger(["rudel", "api", "maintenance"]);
const DEFAULT_LANGUAGE_SIGNAL_BATCH_SIZE = 25;
const MAINTENANCE_MAX_PASSES_PER_STEP = 50;
// Two sequential 90-second repair windows leave at least two minutes of the
// 300-second function duration for language reconciliation and shutdown.
const MAINTENANCE_STEP_DEADLINE_MS = 90_000;

export async function handleApiMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const result = await runApiMaintenance();
		return Response.json(result, { status: result.ok ? 200 : 500 });
	} catch (error) {
		logger.error("Daily API maintenance failed: {error}", {
			error: String(error),
		});
		return Response.json({ error: "Maintenance failed" }, { status: 500 });
	}
}

async function runApiMaintenance() {
	const clickHousePurge = await runMaintenanceStep(
		"clickhouse-purge",
		runClickHouseMaintenance,
	);
	const r2Ingest = await runMaintenanceStep("r2-ingest", runR2Maintenance);
	const languageSignals = await runMaintenanceStep("language-signals", () =>
		reconcileSessionLanguageSignalsUntilCaughtUp(
			readPositiveSafeIntegerEnv(
				"LANGUAGE_SIGNAL_RECONCILE_BATCH_SIZE",
				DEFAULT_LANGUAGE_SIGNAL_BATCH_SIZE,
			),
		),
	);

	return {
		clickHousePurge,
		languageSignals,
		ok:
			clickHousePurge.status === "ok" &&
			r2Ingest.status === "ok" &&
			languageSignals.status === "ok",
		r2Ingest,
	};
}

async function runClickHouseMaintenance() {
	const resend = readResendConfig();
	const drain = await runMaintenancePassLoop("clickhouse-purge", () =>
		runClickHousePurgeWorkerPass({ resend }),
	);

	return {
		hasMore: drain.hasMore,
		iterations: drain.iterations,
		processed: drain.results.reduce(
			(total, result) => total + result.processed,
			0,
		),
		stopReason: drain.stopReason,
	};
}

async function runMaintenanceStep<TResult>(
	name: string,
	run: () => Promise<TResult>,
): Promise<
	| { readonly result: TResult; readonly status: "ok" }
	| { readonly status: "error" }
> {
	try {
		return { result: await run(), status: "ok" };
	} catch (error) {
		logger.error("Daily API maintenance step failed ({name}): {error}", {
			error: String(error),
			name,
		});
		return { status: "error" };
	}
}

async function runR2Maintenance() {
	const availability = readR2IngestAvailability();
	if (!availability.enabled) {
		return {
			attempted: 0,
			completed: 0,
			enabled: false,
			hasMore: false,
			iterations: 0,
			nextDueAt: null,
			stopReason: "complete",
		};
	}

	const r2 = createR2MultipartUploadClient(availability.configuration);
	const drain = await runMaintenancePassLoop("r2-ingest", () =>
		runR2IngestRepairPass(r2),
	);

	return {
		attempted: drain.results.reduce(
			(total, result) => total + result.attempted,
			0,
		),
		completed: drain.results.reduce(
			(total, result) => total + result.completed,
			0,
		),
		enabled: true,
		hasMore: drain.hasMore,
		iterations: drain.iterations,
		nextDueAt: drain.results.at(-1)?.nextDueAt ?? null,
		stopReason: drain.stopReason,
	};
}

async function runMaintenancePassLoop<TResult extends MaintenancePassResult>(
	name: string,
	runPass: () => Promise<TResult>,
): Promise<MaintenanceDrainResult<TResult>> {
	const drain = await drainMaintenancePasses({
		deadlineAt: Date.now() + MAINTENANCE_STEP_DEADLINE_MS,
		maxIterations: MAINTENANCE_MAX_PASSES_PER_STEP,
		now: Date.now,
		runPass,
	});

	if (drain.hasMore) {
		logger.warn(
			"Daily API maintenance left queued work ({name}) after {iterations} passes ({stopReason}); the next cron will continue",
			{
				iterations: drain.iterations,
				name,
				stopReason: drain.stopReason,
			},
		);
	}

	return drain;
}
