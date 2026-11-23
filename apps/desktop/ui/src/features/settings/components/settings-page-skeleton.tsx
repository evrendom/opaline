import type { ReactNode } from "react";
import { Badge } from "@/app/ui/badge";
import { Bones, Reveal } from "@/app/ui/bones";
import type { PrimarySettingsRouteId } from "@/features/settings/config/settings-routes";
import { REPORTS_SETTINGS_DESCRIPTION } from "@/features/settings/reports/reports-settings-copy";
import { SessionsSettingsSample } from "@/features/settings/sessions/sessions-settings-view";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import {
	AccountSettingsSample,
	MembersSettingsSample,
	WorkspaceSettingsSample,
} from "./settings-page-samples";

function SettingsPageSample({ routeId }: { routeId: PrimarySettingsRouteId }) {
	if (routeId === "sessions") return <SessionsSettingsSample />;
	return (
		<div className="settings-page">
			{routeId === "workspace" ? (
				<WorkspaceSettingsSample />
			) : routeId === "members" ? (
				<MembersSettingsSample />
			) : routeId === "reports" ? (
				<WorkspaceSettingsGroup
					title="Reports"
					description={REPORTS_SETTINGS_DESCRIPTION}
				>
					{["first", "second", "third"].map((key) => (
						<WorkspaceSettingsRow
							key={key}
							label="A saved analysis of the team's sessions"
							description="Saved last week"
						>
							<Badge>Shared</Badge>
						</WorkspaceSettingsRow>
					))}
				</WorkspaceSettingsGroup>
			) : (
				<AccountSettingsSample />
			)}
		</div>
	);
}

export function SettingsPageSkeleton({
	routeId,
}: {
	routeId: PrimarySettingsRouteId;
}) {
	return (
		<Bones label={`Loading ${routeId} settings`}>
			<SettingsPageSample routeId={routeId} />
		</Bones>
	);
}

export function SettingsPageReveal({
	children,
	loading,
	routeId,
}: {
	children: () => ReactNode;
	loading: boolean;
	routeId: PrimarySettingsRouteId;
}) {
	return (
		<Reveal
			label={`Loading ${routeId} settings`}
			loading={loading}
			sample={<SettingsPageSample routeId={routeId} />}
			sampleId={`settings-${routeId}`}
		>
			{children}
		</Reveal>
	);
}
