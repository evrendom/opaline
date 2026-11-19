import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const INVOCATION_BUDGET_MS = 240_000;

export async function handleRunIndexHealMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const idle = await import("../services/idle-activity.js");
	const skipped = idle.idleCronResponse(await idle.cronGate());
	if (skipped) return skipped;
	const { runConfiguredRunIndexHealTick } = await import(
		"../services/l1-edges/run-index-heal-worker.service.js"
	);
	const runIndexHeal =
		await runConfiguredRunIndexHealTick(INVOCATION_BUDGET_MS);
	return Response.json({ ok: true, runIndexHeal });
}
