import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import { GitHubRepositoryList } from "@/features/settings/github/GitHubRepositoryList";
import { useGitHubConnection } from "@/features/settings/github/use-github-connection";
import { GitHubTokenCard } from "@/features/settings/workspace/components/GitHubTokenCard";

export function WorkspaceGitHubConnection({
	organizationId,
}: {
	organizationId: string;
}) {
	const { query } = useGitHubConnection(organizationId);
	return <WorkspaceGitHubConnectionView evidenceStatus={query.data} />;
}

export function WorkspaceGitHubConnectionView({
	evidenceStatus,
}: {
	evidenceStatus: GitHubRepositoryEvidenceStatus | undefined;
}) {
	if (evidenceStatus?.visibility !== "visible") return null;
	const connection = evidenceStatus.connection;
	if (!connection.token) return null;
	return (
		<>
			<GitHubTokenCard
				token={connection.token}
				dashboard={evidenceStatus.dashboard}
			/>
			{connection.repositories.length > 0 ? (
				<GitHubRepositoryList status={connection} />
			) : null}
		</>
	);
}
