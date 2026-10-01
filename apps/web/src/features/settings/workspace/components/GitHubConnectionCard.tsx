import type { GitHubRepositoryConnectionStatus } from "@rudel/api-routes";
import { useState } from "react";
import { Button, buttonVariants } from "@/app/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/ui/dialog";
import { Skeleton } from "@/app/ui/skeleton";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import "./github-connection-card.css";

export function GitHubConnectionCard({
	status,
	isPending,
	isError,
	isConnecting,
	isDisconnecting = false,
	actionError,
	onConnect,
	onDisconnect,
	onRetry,
}: {
	status: GitHubRepositoryConnectionStatus | undefined;
	isPending: boolean;
	isError: boolean;
	isConnecting: boolean;
	isDisconnecting?: boolean;
	actionError: string | null;
	onConnect: () => void;
	onDisconnect?: () => Promise<boolean>;
	onRetry: () => void;
}) {
	const connected = status?.connected === true;
	const suspended = connected && status?.suspended === true;
	const canManage = status?.canManage === true;
	return (
		<WorkspaceSettingsGroup
			title="Connection"
			description="Connect GitHub so Opaline can count merged pull requests and CI runs in your repositories and attach them to sessions. Opaline reads metadata only: pull requests, CI runs and commits, never code."
		>
			<WorkspaceSettingsRow
				label="Account"
				description={
					<ConnectionDescription status={status} isError={isError} />
				}
			>
				<ConnectionControl
					status={status}
					isPending={isPending}
					isError={isError}
					isBusy={isConnecting || isDisconnecting}
					isConnecting={isConnecting}
					onConnect={onConnect}
					onRetry={onRetry}
				/>
			</WorkspaceSettingsRow>

			{status && connected && !suspended ? (
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
							href="../../dashboard?metric=mergedPullRequests"
						>
							Open dashboard
						</a>
					) : null}
				</WorkspaceSettingsRow>
			) : null}

			{status && connected && canManage && !suspended ? (
				<WorkspaceSettingsRow
					label="CI history"
					description="GitHub deletes CI runs after 90 days by default. Raise Actions retention on GitHub to keep more."
				>
					<a href={status.manageUrl ?? undefined}>Check GitHub access</a>
				</WorkspaceSettingsRow>
			) : null}

			{connected && canManage && onDisconnect ? (
				<DisconnectRow
					accountLogin={status?.accountLogin ?? null}
					isBusy={isConnecting || isDisconnecting}
					isDisconnecting={isDisconnecting}
					onDisconnect={onDisconnect}
				/>
			) : null}

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
		return <>GitHub connections aren't set up on this deployment yet.</>;
	}
	if (!status.connected) {
		return status.canManage ? (
			<>Connect this workspace to choose repositories.</>
		) : (
			<>Ask a workspace admin to connect GitHub.</>
		);
	}
	const account = (
		<strong>
			{status.accountLogin ?? "GitHub"}
			{status.accountType === "User" ? " (personal account)" : null}
		</strong>
	);
	if (status.suspended) {
		return (
			<>
				The installation on {account} is suspended, so syncing is paused.
				{status.canManage ? null : " Ask a workspace admin to unsuspend it."}
			</>
		);
	}
	return (
		<>
			Connected to {account}
			{status.canManage ? null : ". Ask a workspace admin to change it."}
		</>
	);
}

function ConnectionControl({
	status,
	isPending,
	isError,
	isBusy,
	isConnecting,
	onConnect,
	onRetry,
}: {
	status: GitHubRepositoryConnectionStatus | undefined;
	isPending: boolean;
	isError: boolean;
	isBusy: boolean;
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
			<Button type="button" size="sm" disabled={isBusy} onClick={onConnect}>
				{isConnecting ? "Opening GitHub…" : "Connect GitHub"}
			</Button>
		) : (
			<span className="github-connection-state">Not connected</span>
		);
	}
	const manageLink =
		status.canManage && status.manageUrl ? (
			<a
				data-slot="button"
				className={buttonVariants({ variant: "outline", size: "sm" })}
				href={status.manageUrl}
				target="_blank"
				rel="noreferrer"
			>
				{status.suspended ? "Unsuspend on GitHub" : "Manage on GitHub"}
				<span className="sr-only"> (opens in a new tab)</span>
			</a>
		) : null;
	return (
		<div className="github-connection-actions">
			{manageLink}
			{status.canManage && !status.suspended ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={isBusy}
					onClick={onConnect}
				>
					{isConnecting ? "Opening GitHub…" : "Reconnect"}
				</Button>
			) : null}
			{status.canManage ? null : (
				<span className="github-connection-state">
					{status.suspended ? "Suspended" : "Connected"}
				</span>
			)}
		</div>
	);
}

function DisconnectRow({
	accountLogin,
	isBusy,
	isDisconnecting,
	onDisconnect,
}: {
	accountLogin: string | null;
	isBusy: boolean;
	isDisconnecting: boolean;
	onDisconnect: () => Promise<boolean>;
}) {
	const [open, setOpen] = useState(false);
	return (
		<WorkspaceSettingsRow
			label="Disconnect"
			description="Uninstalls the Opaline GitHub App and stops syncing. Collected pull request and CI history is hidden, not deleted, and comes back if you reconnect."
		>
			<Button
				type="button"
				variant="destructive"
				size="sm"
				disabled={isBusy}
				onClick={() => setOpen(true)}
			>
				Disconnect GitHub
			</Button>
			<Dialog
				open={open}
				onOpenChange={(next) => !isDisconnecting && setOpen(next)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Disconnect GitHub?</DialogTitle>
						<DialogDescription>
							This uninstalls the Opaline GitHub App from{" "}
							{accountLogin ? <strong>{accountLogin}</strong> : "GitHub"} and
							stops syncing pull requests and CI runs for this workspace.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							disabled={isDisconnecting}
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={isDisconnecting}
							onClick={() => {
								void onDisconnect().then((disconnected) => {
									if (disconnected) setOpen(false);
								});
							}}
						>
							{isDisconnecting ? "Disconnecting…" : "Disconnect"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</WorkspaceSettingsRow>
	);
}
