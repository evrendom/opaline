import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const INVOCATION_BUDGET_MS = 240_000;

/**
 * Minute cron, listed several times so invocations overlap: fills in the
 * search chunks that sessions uploaded before search was on did not get
 * (`history-maintenance.service.ts`).
 */
export async function handleHistoryMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const idle = await import("../services/idle-activity.js");
	const skipped = idle.idleCronResponse(await idle.cronGate());
	if (skipped) return skipped;
	// Unauthorized probes must not initialize database or provider clients.
	const { runHistoryMaintenance } = await import(
		"../services/history-maintenance.service.js"
	);
	const history = await runHistoryMaintenance({
		budgetMs: INVOCATION_BUDGET_MS,
	});
	return Response.json({ history, ok: true });
}
