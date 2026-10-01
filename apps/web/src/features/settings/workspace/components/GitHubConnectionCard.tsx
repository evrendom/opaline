import type { GitHubRepositoryConnectionStatus } from "@rudel/api-routes";
import { Button, buttonVariants } from "@/app/ui/button";
import { Skeleton } from "@/app/ui/skeleton";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import "./github-connection-card.css";

const VISIBLE_REPOSITORY_LIMIT = 12;

export function GitHubConnectionCard({
	status,
	isPending,
	isError,
	isConnecting,
	actionError,
	onConnect,
	onRetry,
}: {
	status: GitHubRepositoryConnectionStatus | undefined;
	isPending: boolean;
	isError: boolean;
	isConnecting: boolean;
	actionError: string | null;
	onConnect: () => void;
	onRetry: () => void;
}) {
	return (
		<WorkspaceSettingsGroup
			title="GitHub"
			description="Connect GitHub so Opaline can count merged pull requests and CI runs in your repositories and attach them to sessions. Session content is not sent to GitHub."
		>
			<WorkspaceSettingsRow
				label="Connection"
				description={
					<ConnectionDescription status={status} isError={isError} />
				}
			>
				<ConnectionControl
					status={status}
					isPending={isPending}
					isError={isError}
					isConnecting={isConnecting}
					onConnect={onConnect}
					onRetry={onRetry}
				/>
			</WorkspaceSettingsRow>

			{status?.connected ? <RepositoryAccess status={status} /> : null}
			{status?.connected ? (
				<WorkspaceSettingsRow
					label="Dashboard"
					description={
						status.dashboard === "visible"
							? "Merged PRs and CI runs are on the dashboard."
							: "Opaline is reading pull request and CI history from GitHub. Merged PRs and CI runs appear on the dashboard when it finishes."
					}
				>
					{status.dashboard === "visible" ? (
						<a
							className="cost-text-button"
							href="../dashboard?metric=mergedPullRequests"
						>
							Open dashboard
						</a>
					) : null}
				</WorkspaceSettingsRow>
			) : null}
			{status?.connected && status.canManage ? (
				<WorkspaceSettingsRow
					label="CI history"
					description="GitHub keeps workflow runs and checks only for each repository's Actions retention period, 90 days by default. Raising it in Settings → Actions → General keeps more history from now on. It can't bring back runs GitHub has already deleted."
				>
					<a href={status.manageUrl ?? undefined}>Check GitHub access</a>
				</WorkspaceSettingsRow>
			) : null}

			<WorkspaceSettingsRow
				label="Opaline CLI"
				description="Existing sessions stay unchanged. New automatic uploads include repository context after you install the upcoming update."
			>
				<div className="github-connection-cli-update">
					<p>The capture update has not been published yet.</p>
					<code>npx opaline@latest update</code>
					<code>npx opaline@latest</code>
					<p>
						After release, update Opaline and review automatic uploads in each
						repository.
					</p>
				</div>
			</WorkspaceSettingsRow>

			{actionError ? (
				<div className="github-connection-error" role="alert">
					{actionError}
				</div>
			) : null}
		</WorkspaceSettingsGroup>
	);
}

function ConnectionDescription({
	status,
	isError,
}: {
	status: GitHubRepositoryConnectionStatus | undefined;
	isError: boolean;
}) {
	if (isError) {
		return <span role="alert">Connection status could not be loaded.</span>;
	}
	if (!status) return <>Checking this workspace…</>;
	if (!status.configured) {
		return <>GitHub connections are not available right now.</>;
	}
	if (!status.connected) {
		return status.canManage ? (
			<>Connect this workspace to select repositories.</>
		) : (
			<>Ask a workspace admin to connect GitHub.</>
		);
	}
	return (
		<>
			Connected to <strong>{status.accountLogin ?? "GitHub"}</strong>
		</>
	);
}

function ConnectionControl({
	status,
	isPending,
	isError,
	isConnecting,
	onConnect,
	onRetry,
}: {
	status: GitHubRepositoryConnectionStatus | undefined;
	isPending: boolean;
	isError: boolean;
	isConnecting: boolean;
	onConnect: () => void;
	onRetry: () => void;
}) {
	if (isPending) return <Skeleton className="h-8 w-full" />;
	if (isError) {
		return (
			<Button type="button" variant="outline" size="sm" onClick={onRetry}>
				Try again
			</Button>
		);
	}
	if (!status?.configured) {
		return <span className="github-connection-state">Unavailable</span>;
	}
	if (!status.connected) {
		return status.canManage ? (
			<Button
				type="button"
				size="sm"
				disabled={isConnecting}
				onClick={onConnect}
			>
				{isConnecting ? "Opening GitHub…" : "Connect GitHub"}
			</Button>
		) : (
			<span className="github-connection-state">Not connected</span>
		);
	}
	return (
		<div className="github-connection-actions">
			<span className="github-connection-state" data-state="connected">
				Connected
			</span>
			{status.manageUrl ? (
				<a
					data-slot="button"
					className={buttonVariants({ variant: "outline", size: "sm" })}
					href={status.manageUrl}
					target="_blank"
					rel="noreferrer"
					aria-label="Manage GitHub connection (opens in a new tab)"
				>
					Manage on GitHub
				</a>
			) : null}
			{status.canManage ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={isConnecting}
					onClick={onConnect}
				>
					{isConnecting ? "Opening GitHub…" : "Reconnect"}
				</Button>
			) : null}
		</div>
	);
}

function RepositoryAccess({
	status,
}: {
	status: GitHubRepositoryConnectionStatus;
}) {
	const repositories = [...status.repositories].sort((left, right) =>
		`${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`),
	);
	const visibleRepositories = repositories.slice(0, VISIBLE_REPOSITORY_LIMIT);
	const hiddenCount = repositories.length - visibleRepositories.length;
	const selectionLabel =
		status.repositorySelection === "all"
			? `Repositories verified during connection (${repositories.length})`
			: `Selected repositories (${repositories.length})`;

	return (
		<WorkspaceSettingsRow
			label="Repository access"
			description={selectionLabel}
		>
			{repositories.length > 0 ? (
				<div className="github-connection-repositories">
					<ul aria-label="Connected GitHub repositories">
						{visibleRepositories.map((repository) => (
							<li key={repository.repositoryId}>
								<span title={`${repository.owner}/${repository.name}`}>
									{repository.owner}/{repository.name}
								</span>
								<small>
									{repository.isPrivate ? "Private" : "Public"} ·{" "}
									{repository.defaultBranch}
								</small>
							</li>
						))}
					</ul>
					{hiddenCount > 0 ? <p>And {hiddenCount} more</p> : null}
				</div>
			) : (
				<p className="github-connection-empty">
					No repositories are available to this connection.
				</p>
			)}
		</WorkspaceSettingsRow>
	);
}
