import { IconLoader2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Button } from "@/app/ui/button";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { activateInvitedWorkspaceOnboarding } from "@/features/cli-onboarding/invited-workspace-onboarding";
import { USER_INVITATIONS_KEY } from "@/features/workspace/hooks/useUserInvitations";
import { authClient } from "@/lib/auth-client";
import "@/features/auth/guest-app.css";
import "@/features/shell/website-button.css";

const InvitationPresentationSchema = z.object({
	inviter: z.object({
		image: z.string().nullable(),
		name: z.string(),
	}),
	organizationName: z.string(),
});

function InvitationLoginRedirectMount({
	invitationId,
}: {
	invitationId: string;
}) {
	useMountEffect(() => {
		const returnUrl = `/invitation/${invitationId}`;
		window.location.href = `/?redirect=${encodeURIComponent(returnUrl)}`;
	});

	return null;
}

export function AcceptInvitationPage() {
	const { invitationId } = useParams<{ invitationId: string }>();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session, isPending: sessionLoading } = authClient.useSession();
	const presentationQuery = useQuery({
		enabled: Boolean(session && invitationId),
		queryFn: () => getInvitationPresentation(invitationId ?? ""),
		queryKey: ["invitation-presentation", invitationId],
	});
	const presentation = presentationQuery.data;
	const organizationName = presentation?.organizationName ?? "your workspace";
	const inviterName = presentation?.inviter.name ?? "your teammate";
	const inviterInitial = inviterName.trim().charAt(0).toUpperCase() || "?";
	const { trackAuthenticationAction } = useAnalyticsTracking({
		pageName: "accept_invitation",
	});
	const [status, setStatus] = useState<
		"idle" | "accepting" | "accepted" | "error"
	>("idle");
	const [error, setError] = useState<string | null>(null);
	const [acceptedOrganizationName, setAcceptedOrganizationName] = useState<
		string | null
	>(null);
	const displayOrganizationName = acceptedOrganizationName ?? organizationName;

	const handleAccept = async () => {
		if (!invitationId) return;
		trackAuthenticationAction({
			actionName: "accept_invitation",
			sourceComponent: "accept_invitation_page",
			authMethod: "invitation",
			targetId: invitationId,
			userId:
				session?.user && "id" in session.user
					? String(session.user.id)
					: undefined,
		});
		setStatus("accepting");
		setError(null);

		const res = await authClient.organization.acceptInvitation({
			invitationId,
		});

		if (res.error) {
			setError(res.error.message ?? "Failed to accept invitation");
			setStatus("error");
			return;
		}

		let destination: string;
		try {
			if (!res.data)
				throw new Error("The invitation did not return a workspace.");
			destination = await activateInvitedWorkspaceOnboarding(
				res.data.member.organizationId,
			);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not open the workspace.",
			);
			setStatus("error");
			return;
		}
		setAcceptedOrganizationName(organizationName);
		setStatus("accepted");
		queryClient.invalidateQueries({ queryKey: USER_INVITATIONS_KEY });
		setTimeout(() => navigate(destination, { replace: true }), 600);
	};

	const handleReject = async () => {
		if (!invitationId) return;
		trackAuthenticationAction({
			actionName: "decline_invitation",
			sourceComponent: "accept_invitation_page",
			authMethod: "invitation",
			targetId: invitationId,
			userId:
				session?.user && "id" in session.user
					? String(session.user.id)
					: undefined,
		});
		await authClient.organization.rejectInvitation({ invitationId });
		navigate("/", { replace: true });
	};

	if (
		sessionLoading ||
		(Boolean(session && invitationId) && presentationQuery.isPending)
	) {
		return (
			<div className="flex min-h-dvh items-center justify-center bg-canvas">
				<IconLoader2 className="size-6 animate-spin text-ink-3" />
			</div>
		);
	}

	if (!session && invitationId) {
		return (
			<>
				<InvitationLoginRedirectMount invitationId={invitationId} />
				<div className="flex min-h-dvh items-center justify-center bg-canvas">
					<IconLoader2 className="size-6 animate-spin text-ink-3" />
				</div>
			</>
		);
	}

	if (presentationQuery.isError) {
		return (
			<div className="opaline-auth-shell">
				<main className="opaline-auth-main">
					<div className="opaline-auth-content">
						<div className="opaline-auth-intro">
							<img
								className="opaline-auth-mark"
								src="/opaline-icon.svg"
								alt="Opaline"
							/>
							<h1>Invitation unavailable</h1>
							<p>This invitation has expired or is no longer available.</p>
						</div>
					</div>
				</main>
			</div>
		);
	}

	return (
		<div className="opaline-auth-shell">
			<main className="opaline-auth-main">
				<div className="opaline-auth-content">
					<div className="opaline-auth-intro" aria-live="polite">
						<img
							className="opaline-auth-mark"
							src="/opaline-icon.svg"
							alt="Opaline"
						/>
						{status === "accepted" ? (
							<>
								<h1>Joining {displayOrganizationName}</h1>
								<p>Opening session setup...</p>
							</>
						) : (
							<>
								<h1 className="flex flex-wrap items-center justify-center gap-x-s gap-y-xs text-balance">
									<span>Join</span>
									<span className="inline-flex items-center gap-s">
										<Avatar size="sm">
											{presentation?.inviter.image ? (
												<AvatarImage
													src={presentation.inviter.image}
													alt={inviterName}
												/>
											) : null}
											<AvatarFallback>{inviterInitial}</AvatarFallback>
										</Avatar>
										<span>{inviterName}</span>
									</span>
									<span>in {displayOrganizationName}</span>
								</h1>
								<p>
									Accept the invitation, then connect and upload your coding
									sessions.
								</p>
							</>
						)}
					</div>

					{status === "accepted" ? null : (
						<div className="opaline-auth-stage flex flex-col gap-m">
							{error ? (
								<p
									className="text-pretty corner-m bg-error/5 px-l py-m text-body-xxl text-error ring-1 ring-error/15 sm:text-body-xl"
									role="alert"
								>
									{error}
								</p>
							) : null}
							<Button
								type="button"
								className="form-button opaline-website-primary-button w-full"
								onClick={handleAccept}
								disabled={status === "accepting"}
							>
								<span>
									{status === "accepting" ? "Joining..." : "Join workspace"}
								</span>
							</Button>
							<Button
								type="button"
								variant="outline"
								className="form-button w-full"
								onClick={handleReject}
								disabled={status === "accepting"}
							>
								Decline invitation
							</Button>
						</div>
					)}
				</div>
			</main>
		</div>
	);
}

async function getInvitationPresentation(invitationId: string) {
	const response = await fetch(
		`/api/invitations/${encodeURIComponent(invitationId)}/presentation`,
		{ credentials: "include" },
	);
	if (!response.ok) {
		throw new Error("Invitation not found or no longer available");
	}
	return InvitationPresentationSchema.parse(await response.json());
}
