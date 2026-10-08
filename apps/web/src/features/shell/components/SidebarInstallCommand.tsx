"use client";

import { SidebarMenuButton, SidebarMenuItem } from "@/app/ui/sidebar";
import {
	CopyIcon,
	useCopyFeedback,
} from "@/features/shell/components/copy-button";

const INSTALL_COMMAND = "npx opaline@latest";

// The landing page's install command, always a click away above Settings.
// The copy icon sits in the nav icon lane and plays the landing animation.
export function SidebarInstallCommand() {
	const { copied, copy } = useCopyFeedback(INSTALL_COMMAND);
	const label = copied
		? "Copied — paste in your terminal"
		: `Copy install command: ${INSTALL_COMMAND}`;

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
				<span className="min-w-0 flex-1 truncate">{INSTALL_COMMAND}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
