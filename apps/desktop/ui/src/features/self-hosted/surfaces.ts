import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import type { SelfHostInfo } from "./self-host-info";

const CLOUD_WORKSPACE_URL_PREFIX = "opaline.so/";

export function workspaceUrlPrefix(
	selfHost: SelfHostInfo | null,
	host?: string,
): string {
	if (!selfHost) return CLOUD_WORKSPACE_URL_PREFIX;
	return `${host ?? window.location.host}/`;
}

export function linkableProviders<T extends string>(
	selfHost: SelfHostInfo | null,
	providers: readonly T[],
): T[] {
	return selfHost
		? providers.filter((provider) => selfHost.auth.social.includes(provider))
		: [...providers];
}

export function showsGitHubSettings(
	status: GitHubRepositoryEvidenceStatus | undefined,
): boolean {
	return status?.visibility === "visible" && status.connection.configured;
}
