import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GitHubConnectionCard } from "@/features/settings/workspace/components/GitHubConnectionCard";
import { client } from "@/lib/orpc";

const CALLBACK_MESSAGES = {
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
} as const;

type GitHubCallbackResult = keyof typeof CALLBACK_MESSAGES;

export function WorkspaceGitHubConnection({
	organizationId,
}: {
	organizationId: string;
}) {
	const location = useLocation();
	const navigate = useNavigate();
	const handledCallback = useRef<string | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const query = useQuery({
		queryKey: ["github-repository-evidence", organizationId],
		queryFn: () => client.githubRepositoryEvidence.status(),
		refetchOnWindowFocus: "always",
		staleTime: 10_000,
	});
	const callbackResult = readGitHubCallbackResult(location.search);

	useEffect(() => {
		if (!callbackResult || handledCallback.current === location.key) return;
		handledCallback.current = location.key;
		const notification = CALLBACK_MESSAGES[callbackResult];
		toast[notification.kind](notification.message);
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

	async function connectGitHub() {
		if (isConnecting) return;
		setIsConnecting(true);
		setActionError(null);
		try {
			const response =
				await client.githubRepositoryEvidence.createInstallation();
			window.location.assign(response.url);
		} catch {
			setActionError("GitHub could not be opened. Please try again.");
			setIsConnecting(false);
		}
	}

	return (
		<WorkspaceGitHubConnectionView
			evidenceStatus={query.data}
			isError={query.isError}
			isConnecting={isConnecting}
			actionError={actionError}
			onConnect={() => void connectGitHub()}
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
}: {
	evidenceStatus: GitHubRepositoryEvidenceStatus | undefined;
	isError: boolean;
	isConnecting: boolean;
	actionError: string | null;
	onConnect: () => void;
	onRetry: () => void;
}) {
	if (evidenceStatus?.visibility !== "visible") return null;
	return (
		<GitHubConnectionCard
			status={evidenceStatus.connection}
			isPending={false}
			isError={isError}
			isConnecting={isConnecting}
			actionError={actionError}
			onConnect={onConnect}
			onRetry={onRetry}
		/>
	);
}

export function readGitHubCallbackResult(
	search: string,
): GitHubCallbackResult | null {
	const value = new URLSearchParams(search).get("github");
	return value && value in CALLBACK_MESSAGES
		? readKnownCallbackResult(value)
		: null;
}

function readKnownCallbackResult(value: string): GitHubCallbackResult | null {
	if (
		value === "connected" ||
		value === "cancelled" ||
		value === "session-required" ||
		value === "forbidden" ||
		value === "error"
	) {
		return value;
	}
	return null;
}
