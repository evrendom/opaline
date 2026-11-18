"use client";

import { SidebarMenuButton, SidebarMenuItem } from "@/app/ui/sidebar";
import { cliLoginCommand } from "@/features/self-hosted/cli-commands";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import {
	CopyIcon,
	useCopyFeedback,
} from "@/features/shell/components/copy-button";

const INSTALL_COMMAND = "npx opaline@latest";

// The landing page's install command, always a click away above Settings.
// The copy icon sits in the nav icon lane and plays the landing animation.
export function SidebarInstallCommand() {
	const selfHost = useSelfHost();
	const command = selfHost
		? cliLoginCommand(window.location.origin)
		: INSTALL_COMMAND;
	const { copied, copy } = useCopyFeedback(command);
	const label = copied
		? "Copied — paste in your terminal"
		: `Copy install command: ${command}`;

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				data-sidebar-interactive=""
				data-copied={copied ? "true" : undefined}
				className="copy-button"
				aria-label={label}
				title={label}
				onClick={() => void copy()}
			>
				<span className="grid size-4.5 shrink-0 place-items-center text-[color:color-mix(in_srgb,var(--muted-foreground)_70%,var(--sidebar))]">
					<CopyIcon className="size-4.5!" />
				</span>
				<span className="min-w-0 flex-1 truncate">{command}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
