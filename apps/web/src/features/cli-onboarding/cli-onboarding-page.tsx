import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	devOnboardingOverride,
	useDevStage,
} from "@/features/desktop/dev-stages";
import {
	setWelcomeSelection,
	useWelcomeSelection,
} from "@/features/desktop/welcome-selection";
import { SelfHostedWelcome } from "@/features/self-hosted/SelfHostedWelcome";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { useProductWindowConnectionTone } from "@/features/shell/components/product-window-backdrop";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { authClient } from "@/lib/auth-client";
import { getCliConnectionTone } from "./cli-connection-state";
import { CliOnboardingContent } from "./cli-onboarding-content";
import { getInvitedWorkspaceId } from "./invited-workspace-onboarding";
import { useCliOnboarding } from "./use-cli-onboarding";
import "../../../../marketing/src/components/InstantV2DemoExperience.css";

export function CliOnboardingPage() {
	const selfHost = useSelfHost();
	const { search } = useLocation();
	const params = new URLSearchParams(search);
	if (selfHost && !params.has("user_code") && !params.has("connect"))
		return <SelfHostedWelcome />;
	return <CliPairingOnboardingPage />;
}

function CliPairingOnboardingPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const searchParams = new URLSearchParams(location.search);
	const deviceUserCode = searchParams.has("connect")
		? null
		: searchParams.get("user_code");
	const invitedWorkspaceId = getInvitedWorkspaceId(location.search);
	const { state } = useOrganization();
	const { data: sessionData, refetch } = authClient.useSession();
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
	const devStage = useDevStage();
	const welcomeSelection = useWelcomeSelection();
	const dev = devStage
		? devOnboardingOverride(
				devStage,
				welcomeSelection,
				state.activeOrg?.id ?? null,
				sessionData?.user.id ?? null,
			)
		: null;
	const snapshot = dev ? dev.snapshot : onboarding.setupSnapshot;
	const tone = getCliConnectionTone(
		snapshot,
		dev ? false : onboarding.setupInactive,
		dev ? null : onboarding.error,
	);
	useProductWindowConnectionTone(tone);
	const reported =
		snapshot?.repositories.filter(
			(repository) => repository.enabled && repository.sessionCount > 0,
		) ?? [];
	const reportedKey = reported.map((repository) => repository.id).join("\n");
	useEffect(() => {
		if (!reportedKey) return;
		setWelcomeSelection(
			reported.map((repository) => ({
				key: repository.id,
				name: repository.name,
				sessionCount: repository.sessionCount,
				sources: repository.sources,
			})),
		);
		return () => setWelcomeSelection([]);
	}, [reportedKey]);

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
			key={devStage ?? "live"}
			snapshot={snapshot}
			authorization={dev ? dev.authorization : onboarding.authorization}
			invitedWorkspaceId={invitedWorkspaceId}
			deviceUserCode={dev ? dev.deviceUserCode : deviceUserCode}
			connectionError={
				dev
					? dev.connectionError
					: (onboarding.error ??
						(onboarding.setupInactive
							? "Your terminal stopped sending updates."
							: null))
			}
			displayCommand={onboarding.displayCommand}
			onCopy={onboarding.copyCommand}
			onPrepareCode={onboarding.prepareCode}
			onFinish={() => {
				if (!dev) void onboarding.openDashboard();
			}}
		/>
	);
}
