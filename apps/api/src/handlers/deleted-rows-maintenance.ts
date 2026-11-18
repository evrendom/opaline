import { getLogger } from "@logtape/logtape";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const logger = getLogger(["rudel", "api", "deleted-rows"]);

export async function handleDeletedRowsMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const [{ getClickhouse }, { runDeletedRowsCleanup }] = await Promise.all([
		import("../clickhouse.js"),
		import("../services/deleted-rows-cleanup.service.js"),
	]);
	const cleanup = await runDeletedRowsCleanup({ executor: getClickhouse() });
	if (cleanup.status === "applied" || cleanup.status === "no_room")
		logger.info("Deleted rows {status} for {table}: {detail}", {
			status: cleanup.status,
			table: cleanup.table?.table ?? "",
			detail: JSON.stringify(cleanup.table),
		});
	return Response.json({ cleanup });
}
