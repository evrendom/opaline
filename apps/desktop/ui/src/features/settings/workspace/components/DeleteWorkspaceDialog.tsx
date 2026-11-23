import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/app/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/ui/dialog";
import { Field, FieldLabel } from "@/app/ui/field";
import { Input } from "@/app/ui/input";
import { client } from "@/lib/orpc";

function DeleteWorkspaceDialogBody({
	onDeleted,
	onOpenChange,
	organization,
}: {
	onOpenChange: (open: boolean) => void;
	organization: { id: string; name: string };
	onDeleted: () => Promise<void>;
}) {
	const { data: sessionCount, isLoading } = useQuery({
		queryKey: ["org-session-count", organization.id],
		queryFn: async () => {
			const response = await client.getOrganizationSessionCount({
				organizationId: organization.id,
			});
			return response.count;
		},
	});
	const [confirmName, setConfirmName] = useState("");
	const [isDeleting, setIsDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const canDelete =
		confirmName.trim().toLowerCase() ===
			organization.name.trim().toLowerCase() && !isDeleting;

	const handleDelete = async () => {
		setIsDeleting(true);
		setError(null);

		try {
			await client.deleteOrganization({
				organizationId: organization.id,
			});
			await onDeleted();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Failed to delete workspace",
			);
			setIsDeleting(false);
		}
	};

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-m">
					<IconAlertTriangle className="text-error" />
					Delete workspace
				</DialogTitle>
				<DialogDescription>
					This permanently deletes <strong>{organization.name}</strong> and
					removes access for every member.
				</DialogDescription>
			</DialogHeader>

			<div className="flex flex-col gap-xl">
				{isLoading ? (
					<div className="flex items-center gap-m text-body-xl text-ink-3">
						<IconLoader2 className="animate-spin" />
						Checking workspace data…
					</div>
				) : (
					<p className="text-body-xl text-ink-3">
						{sessionCount && sessionCount > 0
							? `${sessionCount} sessions are attached to this workspace and will be removed.`
							: "No session data is attached to this workspace."}
					</p>
				)}

				<Field className="gap-m">
					<FieldLabel htmlFor="delete-workspace-confirm">
						Type {organization.name} to confirm
					</FieldLabel>
					<Input
						variant="plain"
						id="delete-workspace-confirm"
						value={confirmName}
						onChange={(event) => setConfirmName(event.target.value)}
						placeholder={organization.name}
					/>
				</Field>

				{error ? <p className="text-body-xl text-error">{error}</p> : null}
			</div>

			<DialogFooter>
				<Button
					type="button"
					variant="primary"
					size="lg"
					onClick={() => onOpenChange(false)}
					disabled={isDeleting}
				>
					Cancel
				</Button>
				<Button
					type="button"
					variant="danger"
					size="lg"
					onClick={handleDelete}
					disabled={!canDelete}
				>
					{isDeleting ? (
						<IconLoader2 data-icon="inline-start" className="animate-spin" />
					) : null}
					Delete workspace
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

export function DeleteWorkspaceDialog({
	open,
	onOpenChange,
	organization,
	onDeleted,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organization: { id: string; name: string };
	onDeleted: () => Promise<void>;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{open ? (
				<DeleteWorkspaceDialogBody
					onDeleted={onDeleted}
					onOpenChange={onOpenChange}
					organization={organization}
				/>
			) : null}
		</Dialog>
	);
}
