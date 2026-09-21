import { useLocation } from "react-router-dom";
import { useOrganization } from "@/features/workspace/organization/useOrganization";

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

export function SupportEmailButton() {
	const { pathname } = useLocation();
	const { state } = useOrganization();
	const href = buildSupportEmailHref({
		pathname,
		workspaceName: state.activeOrg?.name,
	});

	return (
		<a
			aria-label="Email Opaline support"
			className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex size-9 items-center justify-center rounded-full bg-popover text-muted-foreground shadow-lg ring-1 ring-foreground/10 outline-none hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:shadow-none"
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
