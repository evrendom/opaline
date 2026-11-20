import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/orpc";

const GITHUB_CONNECTION_QUERY_KEY = "github-repository-evidence";

export function useGitHubConnection(organizationId: string | null) {
	const query = useQuery({
		queryKey: [GITHUB_CONNECTION_QUERY_KEY, organizationId],
		queryFn: () => client.githubRepositoryEvidence.status(),
		enabled: organizationId !== null,
		refetchOnWindowFocus: "always",
		staleTime: 10_000,
		refetchInterval: (current) =>
			current.state.data?.visibility === "visible" &&
			current.state.data.dashboard === "syncing"
				? 30_000
				: false,
	});

	return { query };
}
