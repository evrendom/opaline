import { Bones } from "@/app/ui/bones";
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

export function SettingsPageSkeleton({
	routeId,
}: {
	routeId: PrimarySettingsRouteId;
}) {
	if (routeId === "sessions")
		return (
			<Bones label="Loading sessions settings">
				<SessionsSettingsSample />
			</Bones>
		);
	return (
		<Bones label={`Loading ${routeId} settings`}>
			<div className="workspace-settings-page">
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
								<span className="workspace-settings-badge">Shared</span>
							</WorkspaceSettingsRow>
						))}
					</WorkspaceSettingsGroup>
				) : (
					<AccountSettingsSample />
				)}
			</div>
		</Bones>
	);
}
