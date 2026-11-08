import { getLogger } from "@logtape/logtape";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const logger = getLogger(["rudel", "api", "analysis-log"]);

export async function handleAnalysisLogRetentionMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { analysisLogStore } = await import(
		"../services/analysis-log/config.js"
	);
	if (analysisLogStore() !== "postgres")
		return Response.json({ ok: true, skipped: "store" });
	const [{ sqlClient }, { expirePostgresAnalysisLog }, { loggableError }] =
		await Promise.all([
			import("../db.js"),
			import("../services/analysis-log/postgres-store.js"),
			import("../services/analysis-log/errors.js"),
		]);
	try {
		const expired = await expirePostgresAnalysisLog(sqlClient);
		return Response.json({ ok: true, ...expired });
	} catch (error) {
		logger.error("Analysis log retention failed: {error}", {
			error: loggableError(error),
		});
		return Response.json({ ok: false }, { status: 500 });
	}
}
