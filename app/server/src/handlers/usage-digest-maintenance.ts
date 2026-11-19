import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

/**
 * Hourly cron: enqueues the daily and weekly usage digests and sends each
 * member theirs in their time zone: the weekly at 09:00 Monday, the daily
 * at 19:00 on weekdays. Off unless USAGE_DIGEST_ENABLED is `true`; without
 * Resend configured it fails rather than marking digests sent that never
 * went out.
 */
export async function handleUsageDigestMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	// Unauthorized probes must not initialize database or provider clients.
	const [
		{ getClickhouse },
		{ readResendConfig },
		{ createResendDigestSender, readUsageDigestConfig, runUsageDigestPass },
	] = await Promise.all([
		import("../clickhouse.js"),
		import("../resend-config.js"),
		import("../services/usage-digest/usage-digest.service.js"),
	]);
	const config = readUsageDigestConfig();
	if (!config.enabled)
		return Response.json({ usageDigest: { enabled: false }, ok: true });
	const resend = readResendConfig();
	if (!resend.apiKey)
		return Response.json(
			{ error: "Usage digests need RESEND_API_KEY" },
			{ status: 503 },
		);
	const result = await runUsageDigestPass({
		clickhouse: getClickhouse(),
		config,
		send: createResendDigestSender({
			apiKey: resend.apiKey,
			from: config.from,
		}),
	});
	const ok = result.failed === 0;
	return Response.json(
		{ usageDigest: { enabled: true, ...result }, ok },
		{ status: ok ? 200 : 503 },
	);
}
