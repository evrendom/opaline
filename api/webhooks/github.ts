import { handleConfiguredGitHubWebhookRequest } from "../../apps/api/src/handlers/github-webhook-http.js";
import { createVercelFunctionHandler } from "../../apps/api/src/lib/vercel-function-handler.js";
import { setupLogging } from "../../apps/api/src/logging.js";

await setupLogging();

const PASS_TIMEOUT_MS = 240_000;
const BATCH_SIZE = 25;

interface GitHubWebhookVercelDependencies {
	readonly handleRequest?: typeof handleConfiguredGitHubWebhookRequest;
	readonly runMaintenance?: (
		collectionIds: readonly string[],
		signal: AbortSignal,
	) => Promise<{ readonly hasMore: boolean }>;
	readonly wait?: (delayMs: number) => Promise<void>;
}

interface VercelFunctionContext {
	readonly waitUntil: (promise: Promise<unknown>) => void;
}

// Isolated from the RPC function so a delivery never loads auth or the router
// and an unsigned request never initializes a database client.
export const POST = createGitHubWebhookVercelHandler();

export function createGitHubWebhookVercelHandler(
	dependencies: GitHubWebhookVercelDependencies = {},
) {
	return (request: Request, context?: VercelFunctionContext) =>
		createVercelFunctionHandler({
			fetch(request) {
				return (
					dependencies.handleRequest ?? handleConfiguredGitHubWebhookRequest
				)(request, (delayMs, collectionIds) => {
					if (!context)
						throw new Error("Vercel webhook continuation context is required.");
					context.waitUntil(
						runRefresh(delayMs, collectionIds).catch((error) => {
							console.error(
								"GitHub webhook continuation failed; inspect durable collection state.",
								error,
							);
						}),
					);
				});
			},
			functionGroup: "github-webhook",
			marksActivity: "always",
		})(request);

	async function runRefresh(
		delayMs: number,
		collectionIds: readonly string[],
	): Promise<void> {
		await (
			dependencies.wait ??
			((delay) => new Promise<void>((resolve) => setTimeout(resolve, delay)))
		)(delayMs);
		const signal = AbortSignal.timeout(PASS_TIMEOUT_MS);
		const runMaintenance =
			dependencies.runMaintenance ??
			(async (ids, passSignal) => {
				const {
					runConfiguredGitHubEvidenceMaintenance,
					runConfiguredGitHubRepositorySweep,
				} = await import(
					"../../apps/api/src/services/github-evidence-worker.service.js"
				);
				const live =
					ids.length > 0
						? await runConfiguredGitHubEvidenceMaintenance(
								BATCH_SIZE,
								passSignal,
								ids,
							)
						: { hasMore: false };
				if (live.hasMore) return live;
				const sweep = await runConfiguredGitHubRepositorySweep(passSignal);
				return { hasMore: sweep.requests > 0 && sweep.hasMore };
			});
		let hasMore = true;
		while (hasMore) {
			signal.throwIfAborted();
			hasMore = (await runMaintenance(collectionIds, signal)).hasMore;
		}
	}
}
