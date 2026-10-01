import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GitHubRepositoryList } from "@/features/settings/github/GitHubRepositoryList";
import { useGitHubConnection } from "@/features/settings/github/use-github-connection";
import { GitHubConnectionCard } from "@/features/settings/workspace/components/GitHubConnectionCard";

export const GITHUB_CALLBACK_MESSAGES = {
	connected: {
		kind: "success",
		message: "GitHub connected to this workspace.",
	},
	cancelled: {
		kind: "info",
		message: "GitHub connection was cancelled.",
	},
	"session-required": {
		kind: "error",
		message: "Sign in again, then reconnect GitHub.",
	},
	forbidden: {
		kind: "error",
		message: "Workspace admin access is required to connect GitHub.",
	},
	error: {
		kind: "error",
		message: "GitHub could not be connected. Please try again.",
	},
	"already-connected": {
		kind: "error",
		message: "This GitHub account is already connected to another workspace.",
	},
} as const;

type GitHubCallbackResult = keyof typeof GITHUB_CALLBACK_MESSAGES;

export function WorkspaceGitHubConnection({
	organizationId,
}: {
	organizationId: string;
}) {
	const location = useLocation();
	const navigate = useNavigate();
	const handledCallback = useRef<string | null>(null);
	const { query, action, actionError, connect, disconnect } =
		useGitHubConnection(organizationId);
	const callbackResult = readGitHubCallbackResult(location.search);

	useEffect(() => {
		if (!callbackResult || handledCallback.current === location.key) return;
		handledCallback.current = location.key;
		const notification = GITHUB_CALLBACK_MESSAGES[callbackResult];
		toast[notification.kind](
			notification.message,
			callbackResult === "connected"
				? {
						description:
							"Tip: raise Actions retention in GitHub to keep more CI history.",
					}
				: undefined,
		);
		if (callbackResult === "connected") void query.refetch();
		const nextSearch = new URLSearchParams(location.search);
		nextSearch.delete("github");
		navigate(
			{
				pathname: location.pathname,
				search: nextSearch.size > 0 ? `?${nextSearch}` : "",
				hash: location.hash,
			},
			{ replace: true },
		);
	}, [callbackResult, location, navigate, query]);

	return (
		<WorkspaceGitHubConnectionView
			evidenceStatus={query.data}
			isError={query.isError}
			isConnecting={action === "connecting"}
			isDisconnecting={action === "disconnecting"}
			actionError={actionError}
			onConnect={() => void connect()}
			onDisconnect={disconnect}
			onRetry={() => void query.refetch()}
		/>
	);
}

/**
 * The GitHub section is dark-launched. It renders only once the server has
 * confirmed it is visible, so a hidden deployment never flashes a pending or
 * failed GitHub card. After that, background refetch errors keep the last
 * known status on screen alongside the retry affordance.
 */
export function WorkspaceGitHubConnectionView({
	evidenceStatus,
	isError,
	isConnecting,
	actionError,
	onConnect,
	onRetry,
	isDisconnecting = false,
	onDisconnect,
}: {
	evidenceStatus: GitHubRepositoryEvidenceStatus | undefined;
	isError: boolean;
	isConnecting: boolean;
	actionError: string | null;
	onConnect: () => void;
	onRetry: () => void;
	isDisconnecting?: boolean;
	onDisconnect?: () => Promise<boolean>;
}) {
	if (evidenceStatus?.visibility !== "visible") return null;
	const connection = evidenceStatus.connection;
	return (
		<>
			<GitHubConnectionCard
				status={connection}
				isPending={false}
				isError={isError}
				isConnecting={isConnecting}
				isDisconnecting={isDisconnecting}
				onDisconnect={onDisconnect}
				actionError={actionError}
				onConnect={onConnect}
				onRetry={onRetry}
			/>
			{connection.connected ? (
				<GitHubRepositoryList status={connection} />
			) : null}
		</>
	);
}

export function readGitHubCallbackResult(
	search: string,
): GitHubCallbackResult | null {
	const value = new URLSearchParams(search).get("github");
	return value && value in GITHUB_CALLBACK_MESSAGES
		? readKnownCallbackResult(value)
		: null;
}

function readKnownCallbackResult(value: string): GitHubCallbackResult | null {
	if (
		value === "connected" ||
		value === "cancelled" ||
		value === "session-required" ||
		value === "forbidden" ||
		value === "already-connected" ||
		value === "error"
	) {
		return value;
	}
	return null;
}
