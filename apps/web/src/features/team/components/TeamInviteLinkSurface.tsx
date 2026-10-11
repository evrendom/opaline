import { IconLink } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import { copyTextToClipboardWithResult } from "@/lib/clipboard";
import { client } from "@/lib/orpc";

const TEAM_LINK_COPY_RESET_MS = 1800;

export function TeamInviteLinkSurface({
	layout = "card",
	organizationId,
}: {
	/** `toolbar`: inline at a toolbar's end, in its pill buttons. */
	layout?: "card" | "row" | "settings" | "toolbar";
	organizationId: string;
}) {
	const [isInviteLinkPending, setIsInviteLinkPending] = useState(false);
	const [teamInviteLink, setTeamInviteLink] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const resetTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (resetTimeoutRef.current !== null) {
				window.clearTimeout(resetTimeoutRef.current);
			}
		};
	}, []);

	async function handleCopyTeamLink() {
		if (!teamInviteLink) {
			return;
		}

		const result = await copyTextToClipboardWithResult(teamInviteLink, {
			preferSelectionCopy: true,
			allowPromptFallback: true,
			promptMessage: "Copy team link: Cmd/Ctrl+C, Enter",
		});

		if (result !== "copied") {
			return;
		}

		if (resetTimeoutRef.current !== null) {
			window.clearTimeout(resetTimeoutRef.current);
		}

		setCopied(true);
		resetTimeoutRef.current = window.setTimeout(() => {
			setCopied(false);
			resetTimeoutRef.current = null;
		}, TEAM_LINK_COPY_RESET_MS);
	}

	async function handleCreateTeamInviteLink() {
		setIsInviteLinkPending(true);
		try {
			const link = await client.teamInviteLink.create({ organizationId });
			setTeamInviteLink(link.invite_url);
			toast.success("Invite link created");
		} catch {
			toast.error("Failed to create invite link");
		} finally {
			setIsInviteLinkPending(false);
		}
	}

	async function handleRevokeTeamInviteLink() {
		setIsInviteLinkPending(true);
		try {
			await client.teamInviteLink.revoke({ organizationId });
			setTeamInviteLink(null);
			toast.success("Invite links revoked");
		} catch {
			toast.error("Failed to revoke invite links");
		} finally {
			setIsInviteLinkPending(false);
		}
	}

	if (layout === "settings") {
		return (
			<div className="workspace-settings-link-surface">
				{teamInviteLink ? (
					<div className="workspace-settings-link-value">
						<Input
							aria-label="Team invite link"
							value={teamInviteLink}
							readOnly
						/>
						<Button
							aria-label={copied ? "Copied team link" : "Copy team link"}
							disabled={isInviteLinkPending}
							onClick={() => void handleCopyTeamLink()}
							size="sm"
							type="button"
							variant="outline"
						>
							{copied ? "Copied" : "Copy"}
						</Button>
					</div>
				) : null}
				<div className="workspace-settings-link-actions">
					<Button
						disabled={isInviteLinkPending}
						onClick={() => void handleCreateTeamInviteLink()}
						size="sm"
						type="button"
						variant="outline"
					>
						{isInviteLinkPending
							? "Working…"
							: teamInviteLink
								? "Replace link"
								: "Create invite link"}
					</Button>
					<Button
						disabled={isInviteLinkPending}
						onClick={() => void handleRevokeTeamInviteLink()}
						size="sm"
						type="button"
						variant="ghost"
					>
						{teamInviteLink ? "Revoke link" : "Revoke existing links"}
					</Button>
				</div>
			</div>
		);
	}

	if (layout === "toolbar") {
		return (
			<div className="flex min-w-0 items-center gap-2">
				{teamInviteLink ? (
					// The link in a pill like the toolbar's search, copied from inside.
					<div className="flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-card pr-1 pl-3 shadow-(--custom-outline-shadow)">
						<IconLink
							aria-hidden="true"
							className="size-3.5 shrink-0 stroke-muted-foreground"
						/>
						<p
							className="max-w-72 min-w-0 truncate font-mono text-xs text-foreground"
							title={teamInviteLink}
						>
							{teamInviteLink}
						</p>
						<button
							type="button"
							aria-label={copied ? "Copied team link" : "Copy team link"}
							className="h-6 shrink-0 cursor-pointer rounded-full bg-foreground px-2.5 text-xs font-medium text-background disabled:opacity-50"
							disabled={isInviteLinkPending}
							onClick={() => void handleCopyTeamLink()}
						>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
				) : null}
				<button
					type="button"
					className="toolbar-button"
					disabled={isInviteLinkPending}
					onClick={() => void handleCreateTeamInviteLink()}
				>
					{teamInviteLink ? null : <IconLink aria-hidden="true" />}
					{teamInviteLink ? "Replace" : "Create invite link"}
				</button>
				<button
					type="button"
					className="toolbar-button"
					disabled={isInviteLinkPending}
					onClick={() => void handleRevokeTeamInviteLink()}
				>
					{teamInviteLink ? "Revoke" : "Revoke existing links"}
				</button>
			</div>
		);
	}

	if (!teamInviteLink) {
		return (
			<div className="flex w-full flex-wrap gap-2">
				<Button
					className="relative"
					disabled={isInviteLinkPending}
					onClick={() => void handleCreateTeamInviteLink()}
					size="sm"
					type="button"
					variant="outline"
				>
					<span
						aria-hidden="true"
						className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
					/>
					Create invite link
				</Button>
				<Button
					className="relative"
					disabled={isInviteLinkPending}
					onClick={() => void handleRevokeTeamInviteLink()}
					size="sm"
					type="button"
					variant="ghost"
				>
					<span
						aria-hidden="true"
						className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
					/>
					Revoke existing links
				</Button>
			</div>
		);
	}

	if (layout === "row") {
		return (
			<div className="flex w-full min-w-0 items-center gap-2">
				<div className="grid h-10 min-w-0 flex-1 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-1 rounded-full border border-black/10 bg-background p-1 dark:border-white/10">
					<IconLink
						aria-hidden="true"
						className="size-4 h-lh shrink-0 justify-self-center stroke-muted-foreground"
					/>
					<p
						className="min-w-0 truncate font-mono text-base font-medium text-foreground sm:text-sm"
						title={teamInviteLink}
					>
						{teamInviteLink}
					</p>
					<Button
						aria-label={copied ? "Copied team link" : "Copy team link"}
						className="relative rounded-full"
						disabled={isInviteLinkPending}
						onClick={() => void handleCopyTeamLink()}
						size="sm"
						type="button"
					>
						<span
							aria-hidden="true"
							className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
						/>
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>
				<Button
					className="relative shrink-0"
					disabled={isInviteLinkPending}
					onClick={() => void handleCreateTeamInviteLink()}
					size="sm"
					type="button"
					variant="ghost"
				>
					<span
						aria-hidden="true"
						className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
					/>
					Replace
				</Button>
				<Button
					className="relative shrink-0"
					disabled={isInviteLinkPending}
					onClick={() => void handleRevokeTeamInviteLink()}
					size="sm"
					type="button"
					variant="ghost"
				>
					<span
						aria-hidden="true"
						className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
					/>
					Revoke
				</Button>
			</div>
		);
	}

	return (
		<div className="flex w-full min-w-0 flex-col gap-2">
			<div className="grid h-11 w-full min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-1 rounded-full border border-black/10 bg-background p-1 dark:border-white/10">
				<IconLink
					aria-hidden="true"
					className="size-4 h-lh shrink-0 justify-self-center stroke-muted-foreground"
				/>
				<p
					className="min-w-0 truncate font-mono text-base font-medium text-foreground sm:text-sm"
					title={teamInviteLink}
				>
					{teamInviteLink}
				</p>
				<Button
					aria-label={copied ? "Copied team link" : "Copy team link"}
					className="relative rounded-full"
					disabled={isInviteLinkPending}
					onClick={() => void handleCopyTeamLink()}
					size="sm"
					type="button"
				>
					<span
						aria-hidden="true"
						className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
					/>
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			<div className="flex justify-end gap-1">
				<Button
					className="relative"
					disabled={isInviteLinkPending}
					onClick={() => void handleCreateTeamInviteLink()}
					size="sm"
					type="button"
					variant="ghost"
				>
					<span
						aria-hidden="true"
						className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
					/>
					Replace
				</Button>
				<Button
					className="relative"
					disabled={isInviteLinkPending}
					onClick={() => void handleRevokeTeamInviteLink()}
					size="sm"
					type="button"
					variant="ghost"
				>
					<span
						aria-hidden="true"
						className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
					/>
					Revoke
				</Button>
			</div>
		</div>
	);
}
