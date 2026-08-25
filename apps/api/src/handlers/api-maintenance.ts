import { getLogger } from "@logtape/logtape";
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
	const clickHousePurge = await runMaintenanceStep("clickhouse-purge", () =>
		runClickHousePurgeWorkerPass({
			resend: readResendConfig(),
		}),
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
			nextDueAt: null,
		};
	}

	const result = await runR2IngestRepairPass(
		createR2MultipartUploadClient(availability.configuration),
	);
	return { ...result, enabled: true };
}
