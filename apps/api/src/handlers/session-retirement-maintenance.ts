import { getLogger } from "@logtape/logtape";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const INVOCATION_BUDGET_MS = 270_000;
const logger = getLogger(["rudel", "api", "session-retirement"]);

export async function handleSessionRetirementMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const idle = await import("../services/idle-activity.js");
	const skipped = idle.idleCronResponse(await idle.cronGate());
	if (skipped) return skipped;
	const [
		{ getClickhouse },
		{ runRetirementPass },
		{ SESSION_RETIREMENT_STORES },
	] = await Promise.all([
		import("../clickhouse.js"),
		import("../services/generation-retirement/retirement.js"),
		import("../services/generation-retirement/stores.js"),
	]);
	const startedAt = Date.now();
	const retirement = await runRetirementPass({
		executor: getClickhouse(),
		deadline: { deadlineAt: startedAt + INVOCATION_BUDGET_MS, now: Date.now },
		stores: SESSION_RETIREMENT_STORES,
	});
	const ok = Object.values(retirement).every((step) => step.status === "ok");
	if (!ok)
		logger.error("Session retirement had failed steps: {retirement}", {
			retirement: JSON.stringify(retirement),
		});
	return Response.json({ retirement, ok }, { status: ok ? 200 : 500 });
}
