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
import { SelfHostedCommand } from "./SelfHostedCommand";
import { selfHostedWelcomeCopy } from "./teammate-setup";
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
		window.location.origin,
		{
			pending: setupStatus.isPending,
			hasUploadedSessions: setupStatus.data?.hasUploadedSessions === true,
			hasCliLogin: setupStatus.data?.hasCliLogin === true,
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
						{copy.forTeammates ? (
							<h2 className="self-hosted-welcome-section-title">
								For teammates
							</h2>
						) : null}
						{copy.steps.length ? (
							<ol className="self-hosted-steps" data-numbered="">
								{copy.steps.map((step) => (
									<li key={step.id}>
										<h3>{step.title}</h3>
										<SelfHostedCommand
											command={step.command}
											label={step.title}
										/>
										<p>{step.description}</p>
									</li>
								))}
							</ol>
						) : null}
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
			<WelcomeSessionPreview snapshot={null} />
		</>
	);
}
