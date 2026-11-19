import type postgres from "postgres";
import {
	type GitHubRepositoryAppConfig,
	uninstallGitHubInstallation,
} from "./github-app.service.js";
import { refreshPrTotalsReadiness } from "./github-outcomes-readiness.service.js";
import { applyInstallationChange } from "./github-webhook-delivery.service.js";

export type GitHubDisconnectResult =
	| "disconnected"
	| "not-connected"
	| "github-failed";

/**
 * Disconnects a workspace from GitHub by uninstalling its app installation.
 * GitHub is called first and outside any transaction: if it refuses, nothing
 * changes locally. Afterwards the local state takes exactly the path of the
 * `installation.deleted` webhook, so retained facts are hidden, not purged,
 * and the webhook that GitHub sends later is a no-op.
 */
export async function disconnectGitHubRepositoryInstallation(input: {
	readonly database: postgres.Sql;
	readonly organizationId: string;
	readonly readConfig: () => GitHubRepositoryAppConfig | null;
	readonly fetch?: typeof globalThis.fetch;
	readonly now?: () => Date;
}): Promise<GitHubDisconnectResult> {
	const installations = await input.database.unsafe<
		Array<{ installation_id: string }>
	>(
		"SELECT installation_id FROM github_app_installation WHERE organization_id = $1 AND status IN ('active', 'suspended') ORDER BY installation_id",
		[input.organizationId],
	);
	if (installations.length === 0) return "not-connected";
	const config = input.readConfig();
	if (!config) return "github-failed";
	for (const { installation_id: installationId } of installations) {
		try {
			await uninstallGitHubInstallation({
				config,
				fetch: input.fetch,
				installationId,
			});
		} catch {
			return "github-failed";
		}
	}
	const now = input.now?.() ?? new Date();
	await input.database.begin(async (transaction) => {
		for (const { installation_id: installationId } of installations) {
			await applyInstallationChange(transaction, {
				change: "deleted",
				installationId,
				now,
				organizationId: input.organizationId,
			});
		}
		await refreshPrTotalsReadiness(transaction, input.organizationId, now);
	});
	return "disconnected";
}
