import { IconLink } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import { TouchTarget } from "@/app/ui/touch-target";
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
			<div className="settings-link-surface">
				{teamInviteLink ? (
					<div className="settings-link-value">
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
				<div className="settings-link-actions">
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
						variant="destructive"
					>
						{teamInviteLink ? "Revoke link" : "Revoke existing links"}
					</Button>
				</div>
			</div>
		);
	}

	if (layout === "toolbar") {
		return (
			<div className="flex min-w-0 items-center gap-m">
				{teamInviteLink ? (
					// The link in a pill like the toolbar's search, copied from inside.
					<div className="flex h-8 min-w-0 items-center gap-s corner-full bg-card pr-xs pl-l shadow-control">
						<IconLink
							aria-hidden="true"
							className="size-3.5 shrink-0 stroke-ink-3"
						/>
						<p
							className="max-w-72 min-w-0 truncate font-data text-body-m text-ink"
							title={teamInviteLink}
						>
							{teamInviteLink}
						</p>
						<Button
							type="button"
							size="xs"
							aria-label={copied ? "Copied team link" : "Copy team link"}
							disabled={isInviteLinkPending}
							onClick={() => void handleCopyTeamLink()}
						>
							{copied ? "Copied" : "Copy"}
						</Button>
					</div>
				) : null}
				<Button
					type="button"
					variant="toolbar"
					disabled={isInviteLinkPending}
					onClick={() => void handleCreateTeamInviteLink()}
				>
					{teamInviteLink ? null : <IconLink aria-hidden="true" />}
					{teamInviteLink ? "Replace" : "Create invite link"}
				</Button>
				<Button
					type="button"
					variant="toolbar"
					disabled={isInviteLinkPending}
					onClick={() => void handleRevokeTeamInviteLink()}
				>
					{teamInviteLink ? "Revoke" : "Revoke existing links"}
				</Button>
			</div>
		);
	}

	if (!teamInviteLink) {
		return (
			<div className="flex w-full flex-wrap gap-m">
				<Button
					className="relative"
					disabled={isInviteLinkPending}
					onClick={() => void handleCreateTeamInviteLink()}
					size="sm"
					type="button"
					variant="outline"
				>
					<TouchTarget />
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
					<TouchTarget />
					Revoke existing links
				</Button>
			</div>
		);
	}

	if (layout === "row") {
		return (
			<div className="flex w-full min-w-0 items-center gap-m">
				<div className="grid h-10 min-w-0 flex-1 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-xs corner-full edge-m border-line bg-canvas p-xs">
					<IconLink
						aria-hidden="true"
						className="size-4 h-lh shrink-0 justify-self-center stroke-ink-3"
					/>
					<p
						className="min-w-0 truncate font-data text-body-xxl font-medium text-ink sm:text-body-xl"
						title={teamInviteLink}
					>
						{teamInviteLink}
					</p>
					<Button
						aria-label={copied ? "Copied team link" : "Copy team link"}
						className="relative corner-full"
						disabled={isInviteLinkPending}
						onClick={() => void handleCopyTeamLink()}
						size="sm"
						type="button"
					>
						<TouchTarget />
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
					<TouchTarget />
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
					<TouchTarget />
					Revoke
				</Button>
			</div>
		);
	}

	return (
		<div className="flex w-full min-w-0 flex-col gap-m">
			<div className="grid h-11 w-full min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-xs corner-full edge-m border-line bg-canvas p-xs">
				<IconLink
					aria-hidden="true"
					className="size-4 h-lh shrink-0 justify-self-center stroke-ink-3"
				/>
				<p
					className="min-w-0 truncate font-data text-body-xxl font-medium text-ink sm:text-body-xl"
					title={teamInviteLink}
				>
					{teamInviteLink}
				</p>
				<Button
					aria-label={copied ? "Copied team link" : "Copy team link"}
					className="relative corner-full"
					disabled={isInviteLinkPending}
					onClick={() => void handleCopyTeamLink()}
					size="sm"
					type="button"
				>
					<TouchTarget />
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			<div className="flex justify-end gap-xs">
				<Button
					className="relative"
					disabled={isInviteLinkPending}
					onClick={() => void handleCreateTeamInviteLink()}
					size="sm"
					type="button"
					variant="ghost"
				>
					<TouchTarget />
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
					<TouchTarget />
					Revoke
				</Button>
			</div>
		</div>
	);
}

export function TeamInviteLinkActionsSample({
	layout = "toolbar",
}: {
	layout?: "settings" | "toolbar";
}) {
	if (layout === "settings")
		return (
			<div className="settings-link-surface">
				<div className="settings-link-actions">
					<Button size="sm" type="button" variant="outline">
						Create invite link
					</Button>
					<Button size="sm" type="button" variant="ghost">
						Revoke existing links
					</Button>
				</div>
			</div>
		);
	return (
		<div className="flex min-w-0 items-center gap-m">
			<Button type="button" variant="toolbar">
				<IconLink aria-hidden="true" />
				Create invite link
			</Button>
			<Button type="button" variant="toolbar">
				Revoke existing links
			</Button>
		</div>
	);
}
