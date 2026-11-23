import { type FormEvent, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import {
	changePassword,
	readPasswordStatus,
	validateNewPassword,
} from "./account-recovery";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./self-hosted-auth";

export function PasswordCard() {
	const formId = useId();
	const [currentPasswordRequired, setCurrentPasswordRequired] = useState<
		boolean | null
	>(null);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [repeated, setRepeated] = useState("");
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		void readPasswordStatus().then((status) => {
			if (live)
				setCurrentPasswordRequired(status?.currentPasswordRequired ?? true);
		});
		return () => {
			live = false;
		};
	}, []);

	const required = currentPasswordRequired !== false;

	async function submit(event: FormEvent) {
		event.preventDefault();
		const invalid = validateNewPassword({
			currentPasswordRequired: required,
			currentPassword,
			newPassword,
			repeated,
		});
		if (invalid) {
			setProblem(invalid);
			return;
		}
		setProblem(null);
		setSaving(true);
		const failure = await changePassword({
			newPassword,
			currentPassword: required ? currentPassword : "",
		});
		setSaving(false);
		if (failure) {
			setProblem(failure);
			return;
		}
		setCurrentPassword("");
		setNewPassword("");
		setRepeated("");
		setCurrentPasswordRequired(true);
		toast.success("Password changed. Other browsers were signed out.");
	}

	const clearProblem = () => {
		if (problem) setProblem(null);
	};

	return (
		<WorkspaceSettingsGroup
			title="Password"
			description={
				required
					? "Changing it signs you out in other browsers. CLI and MCP keys keep working."
					: "You signed in with a sign-in link, so you can set a new password without the old one for an hour. Changing it signs you out in other browsers."
			}
		>
			{required ? (
				<WorkspaceSettingsRow
					label="Current password"
					controlId={`${formId}-current`}
				>
					<Input
						id={`${formId}-current`}
						form={formId}
						type="password"
						autoComplete="current-password"
						value={currentPassword}
						maxLength={MAX_PASSWORD_LENGTH}
						onChange={(event) => {
							setCurrentPassword(event.target.value);
							clearProblem();
						}}
						disabled={saving}
					/>
				</WorkspaceSettingsRow>
			) : null}
			<WorkspaceSettingsRow
				label="New password"
				description={`${MIN_PASSWORD_LENGTH} characters or more.`}
				controlId={`${formId}-new`}
			>
				<Input
					id={`${formId}-new`}
					form={formId}
					type="password"
					autoComplete="new-password"
					value={newPassword}
					maxLength={MAX_PASSWORD_LENGTH}
					onChange={(event) => {
						setNewPassword(event.target.value);
						clearProblem();
					}}
					disabled={saving}
				/>
			</WorkspaceSettingsRow>
			<WorkspaceSettingsRow
				label="Repeat new password"
				controlId={`${formId}-repeat`}
			>
				<Input
					id={`${formId}-repeat`}
					form={formId}
					type="password"
					autoComplete="new-password"
					value={repeated}
					maxLength={MAX_PASSWORD_LENGTH}
					onChange={(event) => {
						setRepeated(event.target.value);
						clearProblem();
					}}
					disabled={saving}
				/>
			</WorkspaceSettingsRow>
			<form id={formId} onSubmit={submit} className="settings-actions">
				{problem ? (
					<p role="alert" className="mb-l text-body-xl text-error">
						{problem}
					</p>
				) : null}
				<Button
					variant="primary"
					type="submit"
					size="md"
					disabled={saving || currentPasswordRequired === null}
				>
					{saving ? "Changing…" : "Change password"}
				</Button>
			</form>
		</WorkspaceSettingsGroup>
	);
}
