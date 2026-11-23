import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/app/ui/button";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

export function AccountDangerZoneCard({
	user,
	onDeleted,
}: {
	user: { email: string; name: string };
	onDeleted: () => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<WorkspaceSettingsGroup title="Danger zone" tone="danger">
				<WorkspaceSettingsRow
					label="Delete account"
					description="Permanently delete your account and all related data. This cannot be undone."
				>
					<Button
						type="button"
						variant="danger"
						size="md"
						onClick={() => setOpen(true)}
					>
						<IconTrash aria-hidden="true" />
						Delete account
					</Button>
				</WorkspaceSettingsRow>
			</WorkspaceSettingsGroup>
			<DeleteAccountDialog
				open={open}
				onOpenChange={setOpen}
				user={user}
				onDeleted={onDeleted}
			/>
		</>
	);
}
