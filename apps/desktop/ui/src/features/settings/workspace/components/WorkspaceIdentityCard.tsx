import { ORG_SLUG_MAX_LENGTH } from "@rudel/api-routes/reserved-slugs";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	getCanonicalAppPath,
	getWorkspaceAppPath,
	getWorkspaceSlugFromPath,
} from "@/app/routes";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { workspaceUrlPrefix } from "@/features/self-hosted/surfaces";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { useWorkspaceSlugAvailability } from "@/features/workspace/organization/use-workspace-slug";
import { authClient } from "@/lib/auth-client";

export function WorkspaceIdentityCard({
	organization,
	canManage,
	onInvalidate,
}: {
	organization: { id: string; name: string; slug: string };
	canManage: boolean;
	onInvalidate: () => void;
}) {
	const navigate = useNavigate();
	const selfHost = useSelfHost();
	const { pathname, search, hash } = useLocation();
	const { trackOrganizationAction } = useAnalyticsTracking({
		pageName: "organization",
	});
	const [isEditingName, setIsEditingName] = useState(false);
	const [editedName, setEditedName] = useState("");
	const [editedSlug, setEditedSlug] = useState("");
	const [isSavingName, setIsSavingName] = useState(false);
	const [renameError, setRenameError] = useState<string | null>(null);
	const slugAvailability = useWorkspaceSlugAvailability(
		isEditingName ? editedSlug : organization.slug,
		organization.slug,
		isEditingName,
	);
	const invalidSlug = ["invalid", "taken", "checking"].includes(
		slugAvailability.status,
	);

	const startEditing = () => {
		trackOrganizationAction({
			actionName: "start_rename_organization",
			targetType: "organization",
			sourceComponent: "workspace_settings_section",
			targetId: organization.id,
		});
		setEditedName(organization.name);
		setEditedSlug(organization.slug);
		setRenameError(null);
		setIsEditingName(true);
	};

	const cancelEditing = () => {
		trackOrganizationAction({
			actionName: "cancel_rename_organization",
			targetType: "organization",
			sourceComponent: "workspace_settings_section",
			targetId: organization.id,
		});
		setIsEditingName(false);
		setRenameError(null);
	};

	const saveName = async () => {
		const trimmedName = editedName.trim();
		if (!trimmedName || invalidSlug || isSavingName) {
			return;
		}

		if (trimmedName === organization.name && editedSlug === organization.slug) {
			setIsEditingName(false);
			return;
		}

		trackOrganizationAction({
			actionName: "rename_organization",
			targetType: "organization",
			sourceComponent: "workspace_settings_section",
			targetId: organization.id,
		});
		setIsSavingName(true);
		setRenameError(null);

		try {
			const response = await authClient.organization.update({
				data: { name: trimmedName, slug: editedSlug },
				organizationId: organization.id,
			});
			if (response.error) {
				setRenameError(
					response.error.message ?? "Could not save your workspace.",
				);
				return;
			}
			if (
				editedSlug !== organization.slug &&
				getWorkspaceSlugFromPath(pathname)
			) {
				navigate(
					getWorkspaceAppPath(
						editedSlug,
						`${getCanonicalAppPath(pathname)}${search}${hash}`,
					),
					{ replace: true },
				);
			}
			onInvalidate();
			setIsEditingName(false);
		} catch {
			setRenameError("Could not save your workspace. Please try again.");
		} finally {
			setIsSavingName(false);
		}
	};

	return (
		<WorkspaceSettingsGroup title="General">
			<WorkspaceSettingsRow label="Name" controlId="workspace-name">
				<Input
					id="workspace-name"
					name="workspace-name"
					value={isEditingName ? editedName : organization.name}
					onFocus={() => {
						if (canManage && !isEditingName) startEditing();
					}}
					onChange={(event) => {
						if (!isEditingName) startEditing();
						setEditedName(event.target.value);
					}}
					onKeyDown={(event) => {
						if (!canManage || !isEditingName || event.nativeEvent.isComposing)
							return;
						if (event.key === "Enter") {
							event.preventDefault();
							void saveName();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							cancelEditing();
						}
					}}
					readOnly={!canManage}
					disabled={isSavingName}
					aria-invalid={Boolean(renameError)}
					aria-describedby={renameError ? "workspace-name-error" : undefined}
				/>
			</WorkspaceSettingsRow>
			<WorkspaceSettingsRow label="Workspace URL" controlId="workspace-slug">
				<div className="workspace-settings-url-control">
					<div className="workspace-settings-url-field">
						<span aria-hidden="true">{workspaceUrlPrefix(selfHost)}</span>
						<Input
							id="workspace-slug"
							name="workspace-slug"
							value={isEditingName ? editedSlug : organization.slug}
							onFocus={() => {
								if (canManage && !isEditingName) startEditing();
							}}
							onChange={(event) => {
								if (!isEditingName) startEditing();
								setEditedSlug(event.target.value.toLowerCase());
							}}
							onKeyDown={(event) => {
								if (
									!canManage ||
									!isEditingName ||
									event.nativeEvent.isComposing
								)
									return;
								if (event.key === "Enter") {
									event.preventDefault();
									void saveName();
								}
								if (event.key === "Escape") {
									event.preventDefault();
									cancelEditing();
								}
							}}
							autoComplete="off"
							autoCapitalize="none"
							spellCheck={false}
							maxLength={ORG_SLUG_MAX_LENGTH}
							readOnly={!canManage}
							disabled={isSavingName}
							aria-invalid={["invalid", "taken"].includes(
								slugAvailability.status,
							)}
							aria-describedby={
								isEditingName ? "workspace-slug-status" : undefined
							}
						/>
					</div>
					{isEditingName ? (
						<output
							id="workspace-slug-status"
							className="workspace-settings-status"
						>
							{slugAvailability.message}
						</output>
					) : null}
				</div>
			</WorkspaceSettingsRow>
			{isEditingName ? (
				<div className="workspace-settings-actions">
					{renameError ? (
						<p
							id="workspace-name-error"
							role="alert"
							className="workspace-settings-error"
						>
							{renameError}
						</p>
					) : null}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={cancelEditing}
						disabled={isSavingName}
					>
						Cancel
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={() => void saveName()}
						disabled={
							isSavingName || editedName.trim().length === 0 || invalidSlug
						}
					>
						{isSavingName ? "Saving…" : "Save"}
					</Button>
				</div>
			) : null}
		</WorkspaceSettingsGroup>
	);
}
