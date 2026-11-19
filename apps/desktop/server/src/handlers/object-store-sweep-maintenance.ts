import { getLogger } from "@logtape/logtape";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const INVOCATION_BUDGET_MS = 240_000;
const logger = getLogger(["rudel", "api", "object-store-sweep"]);

export async function handleObjectStoreSweepRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const [storage, sweep] = await Promise.all([
		import("../services/r2-ingest-storage.service.js"),
		import("../services/object-store-sweep.service.js"),
	]);
	const availability = storage.readR2IngestAvailability();
	if (
		!availability.enabled ||
		!sweep.needsObjectStoreSweep(availability.configuration)
	) {
		return Response.json({ objectStore: { enabled: false }, ok: true });
	}
	const startedAt = Date.now();
	try {
		const result = await sweep.sweepObjectStore({
			deadline: {
				deadlineAt: startedAt + INVOCATION_BUDGET_MS,
				now: Date.now,
			},
			now: new Date(startedAt),
			store: storage.createObjectStoreClient(availability.configuration),
		});
		return Response.json({
			objectStore: { enabled: true, ...result },
			ok: true,
		});
	} catch (error) {
		logger.error("Object store sweep failed: {error}", {
			error: error instanceof Error ? error.message : String(error),
		});
		return Response.json(
			{ error: "Object store sweep failed" },
			{ status: 500 },
		);
	}
}
