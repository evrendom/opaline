import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const INVOCATION_BUDGET_MS = 240_000;

/** Minute cron: builds due L1 edge scopes within the invocation budget. */
export async function handleL1EdgesMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	// Unauthorized probes must not initialize database or provider clients.
	const { isL1EdgeWorkerEnabled, runConfiguredL1EdgePass } = await import(
		"../services/l1-edges/l1-edge-worker.service.js"
	);
	if (!isL1EdgeWorkerEnabled())
		return Response.json({ l1Edges: { enabled: false }, ok: true });
	const built = await runConfiguredL1EdgePass(INVOCATION_BUDGET_MS);
	return Response.json({ l1Edges: { enabled: true, built }, ok: true });
}
