import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { WelcomePanel } from "@/features/cli-onboarding/welcome-panel";
import { WelcomeSessionPreview } from "@/features/cli-onboarding/welcome-session-preview";
import { useShellOnboardingPanel } from "@/features/shell/shell-onboarding-panel";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { SelfHostedCommand } from "./SelfHostedCommand";
import { teammateSetupSteps } from "./teammate-setup";
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
	const workspace = state.activeOrg ?? state.organizations[0];
	const connected =
		setupStatus.data?.hasUploadedSessions === true ||
		setupStatus.data?.hasCliLogin === true;
	const steps = teammateSetupSteps(window.location.origin);
	return (
		<>
			{panel &&
				createPortal(
					<WelcomePanel>
						<h1>
							{setupStatus.isPending
								? "Checking your setup…"
								: setupStatus.data?.hasUploadedSessions
									? "Your sessions are arriving"
									: connected
										? "Your terminal is connected"
										: "Connect your terminal"}
						</h1>
						<p>
							{connected
								? "Sessions upload from this computer as each one ends. Teammates set up their own computers with these commands."
								: "Run these on each computer whose coding sessions you want in Opaline."}
						</p>
						{connected ? (
							<h2 className="self-hosted-welcome-section-title">
								For teammates
							</h2>
						) : null}
						<ol className="self-hosted-steps" data-numbered="">
							{steps.map((step) => (
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
