import { useLayoutEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { cn } from "@/lib/utils";

const SUPPORT_EMAIL = "evren@opaline.so";

export function buildSupportEmailHref({
	pathname,
	workspaceName,
}: {
	pathname: string;
	workspaceName: string | undefined;
}) {
	const subject = "Opaline support request";
	const body = [
		"Hi Opaline Team,",
		"",
		"I need help with:",
		"",
		"[Describe what happened]",
		"",
		`Workspace: ${workspaceName ?? "Not available"}`,
		`Page: ${pathname}`,
		"",
		"Best,",
	].join("\n");

	return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

let dockedCount = 0;
const dockedListeners = new Set<() => void>();

function subscribeDocked(listener: () => void) {
	dockedListeners.add(listener);
	return () => {
		dockedListeners.delete(listener);
	};
}

function setDocked(change: number) {
	dockedCount += change;
	for (const listener of dockedListeners) listener();
}

function useSupportDocked() {
	return useSyncExternalStore(
		subscribeDocked,
		() => dockedCount > 0,
		() => false,
	);
}

function SupportEmailLink({ className }: { className: string }) {
	const { pathname } = useLocation();
	const { state } = useOrganization();
	const href = buildSupportEmailHref({
		pathname,
		workspaceName: state.activeOrg?.name,
	});

	return (
		<a
			aria-label="Email Opaline support"
			className={cn(
				"flex items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				className,
			)}
			href={href}
			title="Email support"
		>
			<span
				aria-hidden="true"
				className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
			/>
			<span aria-hidden="true" className="font-medium">
				?
			</span>
			<span className="sr-only">Email Opaline support</span>
		</a>
	);
}

export function SupportEmailButton() {
	if (useSupportDocked()) return null;
	return (
		<SupportEmailLink className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 size-9 bg-popover shadow-lg ring-1 ring-foreground/10 hover:bg-accent dark:shadow-none" />
	);
}

export function DockedSupportEmailButton({
	className,
}: {
	className?: string;
}) {
	useLayoutEffect(() => {
		setDocked(1);
		return () => setDocked(-1);
	}, []);
	return (
		<SupportEmailLink
			className={cn(
				"relative size-5 text-[0.6875rem] ring-1 ring-foreground/10 transition-colors hover:bg-accent",
				className,
			)}
		/>
	);
}
