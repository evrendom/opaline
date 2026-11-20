import { type FormEvent, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appRoutes, getWorkspaceAppPath } from "@/app/routes";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { authClient } from "@/lib/auth-client";

function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.slice(0, 48);
}

export function CreateWorkspaceCard({
	description = "Create a separate workspace for another team or client.",
	submitLabel = "Create workspace",
	title = "Create workspace",
}: {
	description?: string;
	submitLabel?: string;
	title?: string;
}) {
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameId = useId();

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault();
		const trimmedName = name.trim();
		const slug = slugify(trimmedName);

		if (!trimmedName || !slug) {
			return;
		}

		setIsCreating(true);
		setError(null);

		const response = await authClient.organization.create({
			name: trimmedName,
			slug,
			keepCurrentActiveOrganization: true,
		});

		if (response.error) {
			setError(response.error.message ?? "Failed to create workspace");
			setIsCreating(false);
			return;
		}

		if (response.data) {
			navigate(
				getWorkspaceAppPath(response.data.slug, appRoutes.settingsWorkspace()),
			);
		}

		setIsCreating(false);
	};

	const slugPreview = slugify(name.trim());

	return (
		<form onSubmit={handleSubmit}>
			<WorkspaceSettingsGroup title={title} description={description}>
				<WorkspaceSettingsRow label="Name" controlId={nameId}>
					<Input
						id={nameId}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Workspace name"
						disabled={isCreating}
						aria-invalid={Boolean(error)}
						aria-describedby={error ? `${nameId}-error` : undefined}
					/>
				</WorkspaceSettingsRow>
				<WorkspaceSettingsRow label="Slug" controlId={`${nameId}-slug`}>
					<Input
						id={`${nameId}-slug`}
						value={slugPreview ? `/${slugPreview}` : ""}
						placeholder="Generated from name"
						readOnly
					/>
				</WorkspaceSettingsRow>
				<div className="workspace-settings-actions">
					{error ? (
						<p
							id={`${nameId}-error`}
							role="alert"
							className="workspace-settings-error"
						>
							{error}
						</p>
					) : null}
					<Button type="submit" size="sm" disabled={isCreating || !slugPreview}>
						{isCreating ? "Creating workspace…" : submitLabel}
					</Button>
				</div>
			</WorkspaceSettingsGroup>
		</form>
	);
}

export function CreateWorkspacePage() {
	return (
		<div className="workspace-settings-page">
			<CreateWorkspaceCard />
		</div>
	);
}
