import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";

function getInitials(name: string, email: string) {
	const source = name.trim() || email.trim() || "R";
	return source
		.split(" ")
		.map((part) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

export function ProfileOverviewCard({
	email,
	image,
	isSigningOut,
	name,
	onSignOut,
	showEmail = true,
}: {
	email: string;
	image: string | null;
	isSigningOut: boolean;
	name: string;
	onSignOut?: () => void;
	showEmail?: boolean;
}) {
	return (
		<WorkspaceSettingsGroup title="Profile">
			<WorkspaceSettingsRow label="Profile photo">
				<Avatar>
					{image ? <AvatarImage src={image} alt={name} /> : null}
					<AvatarFallback>{getInitials(name, email)}</AvatarFallback>
				</Avatar>
			</WorkspaceSettingsRow>
			<WorkspaceSettingsRow label="Name" controlId="account-name">
				<Input id="account-name" value={name} readOnly />
			</WorkspaceSettingsRow>
			{showEmail ? (
				<WorkspaceSettingsRow label="Email" controlId="account-email">
					<Input id="account-email" type="email" value={email} readOnly />
				</WorkspaceSettingsRow>
			) : null}
			{onSignOut ? (
				<WorkspaceSettingsRow
					label="Session"
					description="Sign out from this device without affecting other sessions."
				>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onSignOut}
						disabled={isSigningOut}
					>
						{isSigningOut ? "Signing out…" : "Sign out"}
					</Button>
				</WorkspaceSettingsRow>
			) : null}
		</WorkspaceSettingsGroup>
	);
}
