import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
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

export function DeleteAccountDialog({
	open,
	onOpenChange,
	user,
	onDeleted,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: { email: string; name: string };
	onDeleted: () => Promise<void>;
}) {
	const [confirmEmail, setConfirmEmail] = useState("");
	const [isDeleting, setIsDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) {
			setConfirmEmail("");
			setIsDeleting(false);
			setError(null);
		}
	}, [open]);

	const emailMatches =
		confirmEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
	const canDelete = emailMatches && !isDeleting;

	const handleDelete = async () => {
		setIsDeleting(true);
		setError(null);
		try {
			await client.profile.deleteMine();
			await onDeleted();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Failed to delete account",
			);
			setIsDeleting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-m">
						<IconAlertTriangle className="text-error" />
						Delete account
					</DialogTitle>
					<DialogDescription>
						This permanently deletes <strong>{user.name}</strong> ({user.email})
						and all account data stored in our database.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-xl">
					<p className="text-body-xl text-ink-3">
						Your account, API keys, sessions, linked logins, workspace
						memberships, and any workspaces where you are the only member will
						be removed. Uploaded session analytics may persist for a short time
						in cold storage.
					</p>

					<Field className="gap-m">
						<FieldLabel htmlFor="delete-account-confirm">
							Type {user.email} to confirm
						</FieldLabel>
						<Input
							variant="plain"
							id="delete-account-confirm"
							value={confirmEmail}
							onChange={(event) => setConfirmEmail(event.target.value)}
							placeholder={user.email}
							autoComplete="off"
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
						onClick={() => void handleDelete()}
						disabled={!canDelete}
					>
						{isDeleting ? (
							<IconLoader2 data-icon="inline-start" className="animate-spin" />
						) : null}
						Delete account
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
