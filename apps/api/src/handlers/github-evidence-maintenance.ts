import { drainMaintenancePasses } from "../lib/bounded-maintenance.js";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const CRON_MAINTENANCE_BATCH_SIZE = 5;
const INVOCATION_BUDGET_MS = 260_000;

export async function handleGitHubEvidenceMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
		// Unauthorized probes must not initialize database or provider clients.
		const {
			runConfiguredGitHubEvidenceMaintenance,
			runConfiguredGitHubRepositorySweep,
		} = await import("../services/github-evidence-worker.service.js");
		const deadlineAt = Date.now() + INVOCATION_BUDGET_MS;
		const drain = await drainMaintenancePasses({
			deadline: { deadlineAt, now: Date.now },
			maxIterations: 1_000,
			runPass: async () => {
				try {
					return await runConfiguredGitHubEvidenceMaintenance(
						CRON_MAINTENANCE_BATCH_SIZE,
						AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())),
					);
				} catch (error) {
					if (Date.now() < deadlineAt) throw error;
					return {
						enabled: true as const,
						attempted: 0,
						failed: 0,
						hasExhaustedFailures: false,
						hasMore: true,
						succeeded: 0,
					};
				}
			},
		});
		const active = drain.results.filter((result) => result.enabled);
		const result = {
			enabled: active.length > 0,
			attempted: active.reduce((sum, result) => sum + result.attempted, 0),
			failed: active.reduce((sum, result) => sum + result.failed, 0),
			succeeded: active.reduce((sum, result) => sum + result.succeeded, 0),
			hasExhaustedFailures: active.some(
				(result) => result.hasExhaustedFailures,
			),
			hasMore: drain.hasMore,
			iterations: drain.iterations,
			stopReason: drain.stopReason,
			continuation: drain.hasMore ? "durable-collection-queue" : null,
		};
		const sweepDrain = await drainMaintenancePasses({
			deadline: { deadlineAt, now: Date.now },
			maxIterations: 1_000,
			runPass: async () => {
				const pass = await runConfiguredGitHubRepositorySweep(
					AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())),
				);
				return {
					...pass,
					pending: pass.hasMore,
					hasMore: pass.requests > 0 && pass.hasMore,
				};
			},
		});
		const sweep = {
			enabled: sweepDrain.results.some((pass) => pass.enabled),
			requests: sweepDrain.results.reduce(
				(sum, pass) => sum + pass.requests,
				0,
			),
			hasMore: sweepDrain.results.at(-1)?.pending ?? sweepDrain.hasMore,
		};
		const ok = result.failed === 0 && !result.hasExhaustedFailures;
		return Response.json(
			{ githubEvidence: result, githubSweep: sweep, ok },
			{ status: ok ? 200 : 503 },
		);
	} catch {
		return Response.json(
			{ error: "GitHub evidence maintenance failed" },
			{ status: 500 },
		);
	}
}
