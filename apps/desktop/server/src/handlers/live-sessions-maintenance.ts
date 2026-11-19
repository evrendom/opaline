import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const INVOCATION_BUDGET_MS = 240_000;

/**
 * Hourly cron: deletes live sessions quiet for 72 hours, the chunks of
 * superseded stream generations (R2 objects before rows) and orphaned
 * objects. Without R2 there is
 * nothing to delete: appends never store a chunk without it.
 */
export async function handleLiveSessionsMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	// Unauthorized probes must not initialize database or storage clients.
	const [{ sqlClient }, storage, { cleanupLiveSessions }, liveR2] =
		await Promise.all([
			import("../db.js"),
			import("../services/r2-ingest-storage.service.js"),
			import("../services/live-session/live-session-cleanup.service.js"),
			import("../services/live-session/live-session-r2.js"),
		]);
	const availability = storage.readR2IngestAvailability();
	if (!availability.enabled)
		return Response.json({ liveSessions: { enabled: false }, ok: true });
	const startedAt = Date.now();
	const result = await cleanupLiveSessions({
		database: sqlClient,
		deadline: {
			deadlineAt: startedAt + INVOCATION_BUDGET_MS,
			now: () => Date.now(),
		},
		now: () => new Date(),
		r2: liveR2.getLiveSessionR2Client(availability.configuration),
	});
	return Response.json({
		liveSessions: { enabled: true, ...result },
		ok: true,
	});
}
