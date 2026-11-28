import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { WelcomePanel } from "@/features/cli-onboarding/welcome-panel";
import { WelcomeSessionPreview } from "@/features/cli-onboarding/welcome-session-preview";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { useShellOnboardingPanel } from "@/features/shell/shell-onboarding-panel";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { selfHostedWelcomeCopy } from "./welcome-copy";
import "@/features/cli-onboarding/cli-onboarding.css";
import "@/features/cli-onboarding/welcome.css";
import "./self-hosted.css";

const SETUP_STATUS_POLL_MS = 5_000;

export function SelfHostedWelcome() {
	const panel = useShellOnboardingPanel();
	const { state } = useOrganization();
	const setupStatus = useQuery({
		...orpc.cli.setupStatus.queryOptions({}),
		refetchInterval: (query) =>
			query.state.data?.hasUploadedSessions ? false : SETUP_STATUS_POLL_MS,
	});
	const localApp = useLocalDesktopApp();
	const workspace = state.activeOrg ?? state.organizations[0];
	const copy = selfHostedWelcomeCopy(
		{
			pending: setupStatus.isPending,
			hasUploadedSessions: setupStatus.data?.hasUploadedSessions === true,
		},
		localApp,
	);
	return (
		<>
			{panel &&
				createPortal(
					<WelcomePanel>
						<h1>{copy.title}</h1>
						<p>{copy.body}</p>
						{workspace ? (
							<Link
								className="self-hosted-welcome-open"
								to={appRoutes.workspaceSessions(workspace.slug)}
							>
								Open your dashboard
							</Link>
						) : null}
					</WelcomePanel>,
					panel,
				)}
			<WelcomeSessionPreview />
		</>
	);
}
