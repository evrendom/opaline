import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useEffectOnceWhen } from "@/app/hooks/useEffectOnceWhen";
import { appRoutes } from "@/app/routes";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { authClient } from "@/lib/auth-client";
import { client } from "@/lib/orpc";

type TeamInviteState =
	| { status: "idle" | "pending" }
	| { message: string; status: "error" }
	| { status: "ready" };

export function TeamInviteAcceptPage() {
	const { token } = useParams<{ token: string }>();
	const { actions } = useOrganization();
	const { data: session, isPending: isSessionPending } =
		authClient.useSession();
	const [state, setState] = useState<TeamInviteState>({ status: "idle" });
	const invitePath = token ? appRoutes.teamInvite(token) : "/";

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
				setState,
				switchOrganization: actions.switchOrganization,
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
		return <TeamInviteStateScreen body="Opening the workspace..." />;
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

export async function acceptTeamInvite(input: {
	setState: (state: TeamInviteState) => void;
	switchOrganization: (
		organizationId: string,
		options?: { destination?: "preserve" | "team" },
	) => Promise<boolean>;
	token: string;
}) {
	const { setState, switchOrganization, token } = input;

	setState({ status: "pending" });

	try {
		const result = await client.teamInviteLink.accept({ token });
		const didSwitch = await switchOrganization(result.organization_id, {
			destination: "team",
		});
		if (!didSwitch) {
			throw new Error(
				"You joined the workspace, but it could not be opened. Refresh and try again.",
			);
		}
		setState({ status: "ready" });
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
		<section className="flex min-h-svh items-center justify-center bg-background px-4 py-6 sm:px-6 lg:px-8">
			<div className="mx-auto w-full max-w-xl space-y-3 text-center">
				<p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
					Opaline team
				</p>
				<h1 className="text-3xl font-semibold text-foreground">{title}</h1>
				<p className="text-sm leading-6 text-muted-foreground sm:text-[0.9375rem]">
					{body}
				</p>
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
