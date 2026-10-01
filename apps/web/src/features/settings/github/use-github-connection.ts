import { ORPCError } from "@orpc/client";
import type { GitHubConnectionReturnTo } from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "@/lib/orpc";

export const GITHUB_CONNECTION_QUERY_KEY = "github-repository-evidence";

type GitHubConnectionAction = "idle" | "connecting" | "disconnecting";

export function useGitHubConnection(
	organizationId: string | null,
	returnTo: GitHubConnectionReturnTo = "settings",
) {
	const queryClient = useQueryClient();
	const [action, setAction] = useState<GitHubConnectionAction>("idle");
	const [actionError, setActionError] = useState<string | null>(null);
	const query = useQuery({
		queryKey: [GITHUB_CONNECTION_QUERY_KEY, organizationId],
		queryFn: () => client.githubRepositoryEvidence.status(),
		enabled: organizationId !== null,
		refetchOnWindowFocus: "always",
		staleTime: 10_000,
	});

	async function connect() {
		if (action !== "idle") return;
		setAction("connecting");
		setActionError(null);
		try {
			const response = await client.githubRepositoryEvidence.createInstallation(
				{ returnTo },
			);
			window.location.assign(response.url);
		} catch {
			setActionError("GitHub could not be opened. Please try again.");
			setAction("idle");
		}
	}

	async function disconnect(): Promise<boolean> {
		if (action !== "idle" || organizationId === null) return false;
		setAction("disconnecting");
		setActionError(null);
		try {
			await client.githubRepositoryEvidence.disconnect({ organizationId });
			return true;
		} catch (error) {
			setActionError(
				error instanceof ORPCError && error.code === "WORKSPACE_CHANGED"
					? error.message
					: "GitHub could not be disconnected. Please try again.",
			);
			return false;
		} finally {
			// A failure can still have changed GitHub's side, so always refresh.
			// Dashboard metrics depend on the connection too.
			await queryClient.invalidateQueries();
			setAction("idle");
		}
	}

	return { query, action, actionError, connect, disconnect };
}
