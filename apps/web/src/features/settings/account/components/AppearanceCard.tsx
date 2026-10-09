import { ThemeSwitcher } from "@/features/settings/account/components/ThemeSwitcher";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";

export function AppearanceCard() {
	return (
		<WorkspaceSettingsGroup title="Appearance">
			<WorkspaceSettingsRow
				label="Theme"
				description="Follow your system, or keep Opaline light or dark on this device."
			>
				<ThemeSwitcher />
			</WorkspaceSettingsRow>
		</WorkspaceSettingsGroup>
	);
}
