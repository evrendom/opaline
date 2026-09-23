import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useProductWindowConnectionTone } from "@/features/shell/components/product-window-backdrop";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { authClient } from "@/lib/auth-client";
import { getCliConnectionTone } from "./cli-connection-state";
import { CliOnboardingContent } from "./cli-onboarding-content";
import { getInvitedWorkspaceId } from "./invited-workspace-onboarding";
import { useCliOnboarding } from "./use-cli-onboarding";
import "../../../../marketing/src/components/InstantV2DemoExperience.css";

export function CliOnboardingPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const searchParams = new URLSearchParams(location.search);
	const deviceUserCode = searchParams.has("connect")
		? null
		: searchParams.get("user_code");
	const invitedWorkspaceId = getInvitedWorkspaceId(location.search);
	const { state } = useOrganization();
	const { refetch } = authClient.useSession();
	const [destination, setDestination] = useState<{
		organizationId: string;
		path: string;
	} | null>(null);
	const openDashboard = useCallback(
		async (organizationId: string, path: string) => {
			const result = await authClient.organization.setActive({
				organizationId,
			});
			if (result.error) throw new Error("Sign in to open your dashboard.");
			await refetch();
			setDestination({ organizationId, path });
		},
		[refetch],
	);
	const onboarding = useCliOnboarding(deviceUserCode === null, {
		mode: "setup",
		autoOpenDashboard: false,
		onOpenDashboard: openDashboard,
	});
	const snapshot = onboarding.setupSnapshot;
	const tone = getCliConnectionTone(
		snapshot,
		onboarding.setupInactive,
		onboarding.error,
	);
	useProductWindowConnectionTone(tone);

	useEffect(() => {
		if (
			destination &&
			!state.isLoading &&
			state.activeOrg?.id === destination.organizationId
		) {
			navigate(destination.path, { replace: true });
		}
	}, [destination, state.isLoading, state.activeOrg?.id, navigate]);

	return (
		<CliOnboardingContent
			snapshot={snapshot}
			authorization={onboarding.authorization}
			invitedWorkspaceId={invitedWorkspaceId}
			deviceUserCode={deviceUserCode}
			connectionError={
				onboarding.error ??
				(onboarding.setupInactive
					? "Your terminal stopped sending updates."
					: null)
			}
			displayCommand={onboarding.displayCommand}
			onCopy={onboarding.copyCommand}
			onFinish={() => void onboarding.openDashboard()}
		/>
	);
}
