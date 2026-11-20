import { useLayoutEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { TouchTarget } from "@/app/ui/touch-target";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { showsSupportEmail } from "@/features/self-hosted/surfaces";
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
				"flex items-center justify-center",
				"corner-full",
				"text-ink-3 outline-none",
				"hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
				className,
			)}
			href={href}
			title="Email support"
		>
			<TouchTarget />
			<span aria-hidden="true" className="font-medium">
				?
			</span>
			<span className="sr-only">Email Opaline support</span>
		</a>
	);
}

export function SupportEmailButton() {
	const selfHost = useSelfHost();
	const docked = useSupportDocked();
	if (docked || !showsSupportEmail(selfHost)) return null;
	return (
		<SupportEmailLink className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 size-9 bg-surface shadow-lg ring-1 ring-ink/10 hover:bg-hover dark:shadow-none" />
	);
}

export function DockedSupportEmailButton({
	className,
}: {
	className?: string;
}) {
	const selfHost = useSelfHost();
	useLayoutEffect(() => {
		setDocked(1);
		return () => setDocked(-1);
	}, []);
	if (!showsSupportEmail(selfHost)) return null;
	return (
		<SupportEmailLink
			className={cn(
				"relative size-5 text-body-s ring-1 ring-ink/10 transition-colors hover:bg-hover",
				className,
			)}
		/>
	);
}
