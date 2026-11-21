import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useEffectOnceWhen } from "@/app/hooks/useEffectOnceWhen";
import { appRoutes } from "@/app/routes";
import { activateInvitedWorkspaceOnboarding } from "@/features/cli-onboarding/invited-workspace-onboarding";
import { authClient } from "@/lib/auth-client";
import { client } from "@/lib/orpc";

type TeamInviteState =
	| { status: "idle" | "pending" }
	| { message: string; status: "error" }
	| { status: "ready"; path: string };

export function TeamInviteAcceptPage() {
	const { token, workspaceSlug } = useParams<{
		token: string;
		workspaceSlug: string;
	}>();
	const navigate = useNavigate();
	const { data: session, isPending: isSessionPending } =
		authClient.useSession();
	const [state, setState] = useState<TeamInviteState>({ status: "idle" });
	const invitePath = token
		? appRoutes.teamInvite(token, workspaceSlug)
		: appRoutes.team();

	useEffectOnceWhen({
		effect: () => {
			if (!token) {
				setState({
					message: "Team invite link is missing.",
					status: "error",
				});
				return;
			}

			void acceptTeamInvite({
				navigateToWelcome: (path) => navigate(path, { replace: true }),
				setState,
				token,
			});
		},
		isReady: !isSessionPending && !!session,
		key: token ?? "missing-token",
	});

	if (isSessionPending) {
		return <TeamInviteStateScreen body="Checking your account..." />;
	}

	if (!session) {
		return (
			<Navigate replace to={`/?redirect=${encodeURIComponent(invitePath)}`} />
		);
	}

	if (state.status === "ready") {
		return <Navigate replace to={state.path} />;
	}

	if (state.status === "error") {
		return (
			<TeamInviteStateScreen
				body={state.message}
				title="Team link unavailable"
			/>
		);
	}

	return <TeamInviteStateScreen body="Joining the workspace..." />;
}

async function acceptTeamInvite(input: {
	navigateToWelcome: (path: string) => void;
	setState: (state: TeamInviteState) => void;
	token: string;
}) {
	const { navigateToWelcome, setState, token } = input;

	setState({ status: "pending" });

	try {
		const result = await client.teamInviteLink.accept({ token });
		const path = await activateInvitedWorkspaceOnboarding(
			result.organization_id,
		);
		setState({ status: "ready", path });
		navigateToWelcome(path);
	} catch (error) {
		setState({
			message: getTeamInviteErrorMessage(error),
			status: "error",
		});
	}
}

function TeamInviteStateScreen(props: { body: string; title?: string }) {
	const { body, title = "Joining workspace" } = props;

	return (
		<section className="flex min-h-svh items-center justify-center bg-canvas px-xl py-xxl sm:px-xxl lg:px-[calc(var(--space-xxl)*4/3)]">
			<div className="mx-auto w-full max-w-xl space-y-l text-center">
				<p
					// design-escape-ok(type): uppercase label tracking, kept as authored
					className="text-body-m font-heavy uppercase tracking-[0.24em] text-ink-3"
				>
					Opaline team
				</p>
				<h1 className="text-display-s font-heavy text-ink">{title}</h1>
				<p className="text-body-xl text-ink-3 sm:text-body-xl">{body}</p>
			</div>
		</section>
	);
}

function getTeamInviteErrorMessage(error: unknown) {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}

	return "This team invite link could not be used. Ask an admin or owner for a new link.";
}
