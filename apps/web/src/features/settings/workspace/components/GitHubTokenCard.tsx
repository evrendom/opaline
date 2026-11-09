import type { GitHubTokenStatus } from "@rudel/api-routes";
import { buttonVariants } from "@/app/ui/button";
import { formatDateTime, formatRelative } from "@/components/dashboard/format";
import { SelfHostedCommand } from "@/features/self-hosted/SelfHostedCommand";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import "@/features/settings/sessions/sessions-settings.css";
import "./github-connection-card.css";

type Dashboard = "notConnected" | "syncing" | "visible";

export function GitHubTokenCard({
	token,
	dashboard,
}: {
	token: GitHubTokenStatus;
	dashboard: Dashboard | undefined;
}) {
	const ready = token.state === "ready";
	const fixNote =
		ready && token.missingScopes.length > 0
			? token.message
			: token.fix
				? "Run this where the server runs. The server reads the token again within a minute; nothing needs a restart."
				: null;
	return (
		<WorkspaceSettingsGroup
			title="GitHub"
			description="This server reads pull requests and CI runs with a GitHub token: GITHUB_TOKEN or GH_TOKEN in its environment, otherwise the GitHub CLI's login where it runs. It only reads, and the token never leaves the server."
		>
			<WorkspaceSettingsRow
				label="Token"
				description={<TokenDescription token={token} />}
			>
				<TokenState token={token} />
			</WorkspaceSettingsRow>
			{token.fix ? (
				<div className="github-token-fix">
					{fixNote ? <p>{fixNote}</p> : null}
					<SelfHostedCommand command={token.fix} label="fix command" />
				</div>
			) : null}
			{ready ? (
				<WorkspaceSettingsRow
					label="Scopes"
					description={
						token.scopes === null
							? "A fine-grained token: it reads the repositories and permissions it was given."
							: "repo lets it read private repositories and their CI logs."
					}
				>
					<span className="github-connection-state">
						{token.scopes === null
							? "Fine-grained"
							: token.scopes.join(", ") || "None"}
					</span>
				</WorkspaceSettingsRow>
			) : null}
			<WorkspaceSettingsRow
				label="Repositories"
				description={<RepositoriesDescription token={token} />}
			>
				<span className="github-connection-state">
					{token.repositories} collected
				</span>
			</WorkspaceSettingsRow>
			<WorkspaceSettingsRow
				label="Last sweep"
				description={`History of the last ${token.historyDays} days. The server asks GitHub every 5 minutes.`}
			>
				<span
					className="github-connection-state"
					title={
						token.lastSweepAt ? formatDateTime(token.lastSweepAt) : undefined
					}
				>
					{token.lastSweepAt ? formatRelative(token.lastSweepAt) : "Not yet"}
				</span>
			</WorkspaceSettingsRow>
			<WorkspaceSettingsRow
				label="Rate limit"
				description={<RateLimitDescription token={token} />}
			>
				<span
					className="sessions-settings-status"
					data-state={token.pausedUntil ? "needs_attention" : "enabled"}
				>
					<span className="sessions-settings-status-dot" aria-hidden="true" />
					{token.pausedUntil
						? `Waiting until ${formatDateTime(token.pausedUntil)}`
						: "Within limit"}
				</span>
			</WorkspaceSettingsRow>
			{dashboard === "visible" ? (
				<WorkspaceSettingsRow
					label="Dashboard"
					description="Merged PRs and CI runs are on the dashboard."
				>
					<a
						data-slot="button"
						data-variant="outline"
						className={buttonVariants({ variant: "outline", size: "sm" })}
						href="../../dashboard?metric=mergedPullRequests"
					>
						Open dashboard
					</a>
				</WorkspaceSettingsRow>
			) : null}
		</WorkspaceSettingsGroup>
	);
}

function TokenDescription({ token }: { token: GitHubTokenStatus }) {
	if (token.state !== "ready")
		return <span role="alert">{token.message ?? "No GitHub token."}</span>;
	const login = <strong>{token.login}</strong>;
	if (token.source === "gh")
		return (
			<>
				The GitHub CLI's login for {login} on {token.host}.
			</>
		);
	return (
		<>
			{token.source} in the server's environment, for {login} on {token.host}.
		</>
	);
}

function TokenState({ token }: { token: GitHubTokenStatus }) {
	const [state, label] =
		token.state === "ready"
			? token.missingScopes.length > 0
				? (["needs_attention", "No repo scope"] as const)
				: (["enabled", "Ready"] as const)
			: token.state === "missing"
				? (["needs_attention", "No token"] as const)
				: token.state === "rejected"
					? (["needs_attention", "Rejected"] as const)
					: (["unknown", "Unreachable"] as const);
	return (
		<span className="sessions-settings-status" data-state={state}>
			<span className="sessions-settings-status-dot" aria-hidden="true" />
			{label}
		</span>
	);
}

function RepositoriesDescription({ token }: { token: GitHubTokenStatus }) {
	const unreadable = token.unreadableRepositories;
	return (
		<>
			The GitHub repositories this workspace's sessions come from, as long as
			the token can read them.
			{unreadable.length > 0 ? (
				<>
					{" "}
					Not readable with this token: {unreadable.slice(0, 5).join(", ")}
					{unreadable.length > 5 ? ` and ${unreadable.length - 5} more` : null}.
				</>
			) : null}
		</>
	);
}

function RateLimitDescription({ token }: { token: GitHubTokenStatus }) {
	const rate = token.rateLimit;
	return (
		<>
			{rate
				? `${rate.remaining.toLocaleString()} of ${rate.limit.toLocaleString()} requests left this hour, renewed at ${formatDateTime(rate.resetAt)}.`
				: "Not known yet."}{" "}
			Collection uses at most half of what is left, so your own use of the token
			keeps working.
		</>
	);
}
