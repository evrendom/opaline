import { ORG_SLUG_MAX_LENGTH } from "@rudel/api-routes/reserved-slugs";
import { CameraIcon, LinkIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { Organization } from "@/features/workspace/organization/types";
import {
	suggestWorkspaceSlug,
	useWorkspaceSlugAvailability,
} from "@/features/workspace/organization/use-workspace-slug";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { authClient } from "@/lib/auth-client";
import { client } from "@/lib/orpc";
import type { CliConnectionSnapshot } from "../../../../../packages/api-routes/src/cli-connection";
import type { CliAuthorization } from "./cli-authorization";
import {
	approveCliAuthorization,
	type CliSession,
	readCliSession,
} from "./cli-onboarding-auth";
import { copyCliCommand } from "./copy-cli-command";
import { WelcomeBack, WelcomeProgress } from "./welcome-panel";

const ProgressSchema = z.object({
	step: z.enum(["workspace", "profile", "invite", "done"]),
	organizationId: z.string().nullable(),
});
type Progress = z.infer<typeof ProgressSchema>;

export function WelcomeSteps({
	session,
	authorization,
	snapshot,
	onFinish,
	onSignOut,
}: {
	session: NonNullable<CliSession>;
	authorization: CliAuthorization;
	snapshot: CliConnectionSnapshot;
	onFinish: () => void;
	onSignOut: () => Promise<void>;
}) {
	const { state, meta } = useOrganization();
	const { refetch } = authClient.useSession();
	const { refetch: refetchOrganizations } = authClient.useListOrganizations();
	const storageKey = `opaline.welcome.${authorization.id}.${session.user.id}`;
	const [progress, setProgress] = useState<Progress>(() =>
		readProgress(storageKey, snapshot),
	);
	const [organizationId, setOrganizationId] = useState(
		snapshot.organizationId ?? progress.organizationId ?? session.user.id,
	);
	const [createdOrganization, setCreatedOrganization] =
		useState<Organization | null>(null);
	const connectedOrganizationId =
		snapshot.organizationId ?? progress.organizationId;
	const organization =
		state.organizations.find(
			(org) => org.id === (connectedOrganizationId ?? organizationId),
		) ??
		createdOrganization ??
		state.organizations.find((org) => org.id === session.user.id) ??
		state.organizations[0];
	const [workspaceName, setWorkspaceName] = useState<string | null>(null);
	const [workspaceSlug, setWorkspaceSlug] = useState<string | null>(null);
	const [name, setName] = useState(session.user.name);
	const [jobTitle, setJobTitle] = useState(session.user.jobTitle ?? "");
	const [image, setImage] = useState(session.user.image ?? null);
	const [emails, setEmails] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const finishing = useRef(false);
	const selectedCount = snapshot.repositories
		.filter((repo) => repo.enabled)
		.reduce((count, repo) => count + repo.sessionCount, 0);
	const isPersonal = organization?.id === session.user.id;
	const canRenameWorkspace =
		isPersonal ||
		(createdOrganization !== null &&
			createdOrganization.id === organization?.id) ||
		(Boolean(connectedOrganizationId) &&
			state.activeOrg?.id === organization?.id &&
			meta.isOrgAdmin);
	const canInvite =
		state.activeOrg?.id === progress.organizationId && meta.isOrgAdmin;
	const slug =
		workspaceSlug ??
		(!connectedOrganizationId && (!organization || isPersonal)
			? suggestWorkspaceSlug(workspaceName ?? organization?.name ?? "")
			: (organization?.slug ?? ""));
	const slugAvailability = useWorkspaceSlugAvailability(
		slug,
		organization?.slug,
		progress.step === "workspace" && !state.isLoading,
	);
	const invalidSlug = ["invalid", "taken", "checking"].includes(
		slugAvailability.status,
	);

	useEffect(() => {
		const sync = (event: StorageEvent) => {
			if (event.key === storageKey && event.newValue)
				setProgress(readProgress(storageKey, snapshot));
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, [storageKey, snapshot]);
	useEffect(() => {
		if (progress.step) heading.current?.focus({ preventScroll: true });
	}, [progress.step]);
	useEffect(() => {
		if (
			progress.step === "done" &&
			snapshot.state === "completed" &&
			!finishing.current
		) {
			finishing.current = true;
			onFinish();
		}
	}, [progress.step, snapshot.state, onFinish]);

	function advance(step: Progress["step"], id = progress.organizationId) {
		const next = { step, organizationId: id };
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			/* The active tab can still complete setup. */
		}
		setProgress(next);
		setError(null);
	}
	async function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not save your changes. Please try again.",
			);
		} finally {
			setBusy(false);
		}
	}
	async function submitWorkspace(event: FormEvent) {
		event.preventDefault();
		await run(async () => {
			if (state.isLoading)
				throw new Error(
					"Your workspace is still loading. Try again in a moment.",
				);
			if (invalidSlug) throw new Error(slugAvailability.message);
			let destination = organization;
			if (
				connectedOrganizationId &&
				destination?.id !== connectedOrganizationId
			)
				throw new Error(
					"Your connected workspace is still loading. Try again in a moment.",
				);
			if (!destination) {
				const name = workspaceName?.trim();
				if (!name) throw new Error("Enter a workspace name.");
				const created = await authClient.organization.create({
					name,
					slug,
				});
				if (created.error || !created.data)
					throw new Error(
						created.error?.message ?? "Could not create your workspace.",
					);
				destination = created.data;
				setCreatedOrganization(destination);
				setOrganizationId(destination.id);
				await refetchOrganizations();
			}
			if (
				canRenameWorkspace &&
				((workspaceName?.trim() && workspaceName.trim() !== destination.name) ||
					slug !== destination.slug)
			) {
				const renamed = await authClient.organization.update({
					organizationId: destination.id,
					data: { name: workspaceName?.trim() || destination.name, slug },
				});
				if (renamed.error)
					throw new Error(
						renamed.error.message ?? "Could not save your workspace name.",
					);
				await refetchOrganizations();
			}
			const active = await authClient.organization.setActive({
				organizationId: destination.id,
			});
			if (active.error)
				throw new Error(
					active.error.message ?? "Could not select this workspace.",
				);
			if (!progress.organizationId && snapshot.state === "awaiting_login")
				await approveCliAuthorization(authorization, destination.id);
			setWorkspaceSlug(slug);
			advance("profile", destination.id);
			await refetch();
		});
	}
	async function saveProfile(event: FormEvent) {
		event.preventDefault();
		await run(async () => {
			await client.profile.updateMine({
				name: name.trim(),
				image,
				jobTitle: jobTitle.trim() || null,
			});
			await refetch();
			advance("invite");
		});
	}
	async function uploadAvatar(file: File) {
		await run(async () => {
			if (
				!["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
				file.size > 2 * 1024 * 1024
			)
				throw new Error("Choose a PNG, JPEG or WebP image smaller than 2 MB.");
			const body = new FormData();
			body.set("file", file);
			const response = await fetch("/api/profile/avatar", {
				method: "POST",
				credentials: "include",
				body,
			});
			if (!response.ok)
				throw new Error("Could not save your picture. Please try again.");
			const updated = await readCliSession();
			setImage(updated?.user.image ?? null);
			await refetch();
		});
	}
	async function sendInvitations(event: FormEvent) {
		event.preventDefault();
		await run(async () => {
			const addresses = [
				...new Set(
					emails
						.split(/[\s,;]+/u)
						.filter(Boolean)
						.map((email) => email.toLowerCase()),
				),
			];
			if (!addresses.length) {
				advance("done");
				return;
			}
			if (addresses.length > 20)
				throw new Error("Invite up to 20 teammates at a time.");
			const invalid = addresses.filter(
				(email) => !z.string().email().safeParse(email).success,
			);
			if (invalid.length)
				throw new Error(`Check these email addresses: ${invalid.join(", ")}`);
			if (!progress.organizationId || !canInvite)
				throw new Error(
					"Only workspace owners and admins can invite teammates.",
				);
			const failed: string[] = [];
			for (const email of addresses) {
				try {
					const result = await authClient.organization.inviteMember({
						email,
						role: "member",
						organizationId: progress.organizationId,
					});
					if (result.error) failed.push(email);
				} catch {
					failed.push(email);
				}
			}
			// Keep only failed addresses so Retry cannot resend successful invitations.
			setEmails(failed.join(", "));
			if (failed.length)
				throw new Error(
					`Could not invite ${failed.join(", ")}. The other invitations were sent.`,
				);
			advance("done");
		});
	}
	function copyInviteLink() {
		if (!progress.organizationId || busy) return;
		setError(null);
		const prepared = client.teamInviteLink
			.create({ organizationId: progress.organizationId })
			.then((result) => ({ command: result.invite_url }))
			.catch(() => {
				setError("Could not create an invite link. Please try again.");
				return null;
			});
		void copyCliCommand(prepared, null).then((copied) => {
			if (copied) toast.success("Invite link copied");
		});
	}
	const stepNumber =
		progress.step === "workspace" ? 2 : progress.step === "profile" ? 3 : 4;
	return (
		<div className="cli-welcome-step" data-welcome-step={progress.step}>
			<WelcomeProgress step={stepNumber} />
			{progress.step !== "workspace" && (
				<WelcomeBack
					disabled={busy}
					onClick={() =>
						advance(
							progress.step === "profile"
								? "workspace"
								: progress.step === "invite"
									? "profile"
									: "invite",
						)
					}
				/>
			)}
			<div key={progress.step} className="cli-welcome-step-content">
				<h1 ref={heading} tabIndex={-1}>
					{progress.step === "workspace"
						? "Set up your workspace"
						: progress.step === "profile"
							? "Set up your profile"
							: progress.step === "invite"
								? "Invite teammates"
								: snapshot.state === "completed"
									? "Your dashboard is ready"
									: "Your sessions are on their way"}
				</h1>
				<p>
					{progress.step === "workspace"
						? "Where your team's sessions will land."
						: progress.step === "profile"
							? "Choose how you’ll appear in your workspace."
							: progress.step === "invite"
								? "Bring your team into the picture."
								: "You’re all set. Your dashboard will open when the upload finishes."}
				</p>
				{error && (
					<p className="cli-onboarding-error" role="alert">
						{error}
					</p>
				)}
				{progress.step === "workspace" && (
					<form
						onSubmit={(event) => void submitWorkspace(event)}
						className="cli-welcome-fields"
					>
						{state.organizations.length > 1 && (
							<div className="cli-welcome-field">
								<label htmlFor="welcome-workspace">Upload to</label>
								<select
									id="welcome-workspace"
									name="workspace"
									value={organization?.id ?? ""}
									disabled={busy || Boolean(connectedOrganizationId)}
									onChange={(event) => {
										setOrganizationId(event.target.value);
										setWorkspaceName(null);
										setWorkspaceSlug(null);
									}}
								>
									{state.organizations.map((org) => (
										<option key={org.id} value={org.id}>
											{org.name}
										</option>
									))}
								</select>
							</div>
						)}
						<div className="cli-welcome-field">
							<label htmlFor="welcome-workspace-name">Name</label>
							<input
								id="welcome-workspace-name"
								name="workspaceName"
								autoComplete="organization"
								value={workspaceName ?? organization?.name ?? ""}
								onChange={(event) => setWorkspaceName(event.target.value)}
								maxLength={100}
								disabled={
									busy ||
									state.isLoading ||
									(Boolean(organization) && !canRenameWorkspace)
								}
								required
							/>
						</div>
						<div className="cli-welcome-field">
							<label htmlFor="welcome-workspace-slug">URL</label>
							<div className="cli-welcome-url-input">
								<span aria-hidden="true">opaline.so/</span>
								<input
									id="welcome-workspace-slug"
									name="workspaceSlug"
									value={slug}
									onChange={(event) =>
										setWorkspaceSlug(event.target.value.toLowerCase())
									}
									autoComplete="off"
									autoCapitalize="none"
									spellCheck={false}
									maxLength={ORG_SLUG_MAX_LENGTH}
									disabled={
										busy ||
										state.isLoading ||
										(Boolean(organization) && !canRenameWorkspace)
									}
									aria-describedby="welcome-workspace-slug-status"
									aria-invalid={["invalid", "taken"].includes(
										slugAvailability.status,
									)}
									required
								/>
							</div>
							<output
								id="welcome-workspace-slug-status"
								className="cli-welcome-slug-status"
								data-status={slugAvailability.status}
							>
								{slugAvailability.message}
							</output>
						</div>
						<p className="cli-welcome-upload-note">
							{progress.organizationId ? (
								<>
									Your selected sessions are connected to this workspace. Your
									repositories will keep syncing.
								</>
							) : (
								<>
									Continuing connects your terminal and uploads{" "}
									{selectedCount.toLocaleString()} selected sessions to this
									workspace. Your selected repositories will keep syncing.
								</>
							)}
						</p>
						<button
							type="submit"
							className="cli-onboarding-primary"
							disabled={
								busy ||
								state.isLoading ||
								invalidSlug ||
								(!organization && !workspaceName?.trim())
							}
						>
							{busy
								? progress.organizationId
									? "Saving…"
									: "Connecting…"
								: progress.organizationId
									? "Continue"
									: "Continue and upload"}
						</button>
						{!connectedOrganizationId && (
							<button
								type="button"
								className="cli-onboarding-text-button"
								disabled={busy}
								onClick={() => void run(onSignOut)}
							>
								Use a different account
							</button>
						)}
					</form>
				)}
				{progress.step === "profile" && (
					<form
						onSubmit={(event) => void saveProfile(event)}
						className="cli-welcome-fields"
					>
						<div className="cli-welcome-field">
							<label htmlFor="welcome-name">Name & picture</label>
							<div className="cli-welcome-profile-row">
								<label
									className="cli-welcome-avatar"
									title="Change profile picture"
								>
									{image ? (
										<img src={image} alt="Your profile" />
									) : (
										<CameraIcon size={20} aria-hidden="true" />
									)}
									<input
										type="file"
										name="avatar"
										accept="image/png,image/jpeg,image/webp"
										aria-label="Change profile picture"
										disabled={busy}
										onChange={(event) => {
											const file = event.target.files?.[0];
											if (file) void uploadAvatar(file);
											event.target.value = "";
										}}
									/>
								</label>
								<input
									id="welcome-name"
									name="name"
									autoComplete="name"
									value={name}
									onChange={(event) => setName(event.target.value)}
									required
									maxLength={100}
									disabled={busy}
								/>
							</div>
						</div>
						<div className="cli-welcome-field">
							<label htmlFor="welcome-job-title">Title</label>
							<input
								id="welcome-job-title"
								name="jobTitle"
								autoComplete="organization-title"
								placeholder="Software engineer"
								value={jobTitle}
								onChange={(event) => setJobTitle(event.target.value)}
								maxLength={100}
								disabled={busy}
							/>
						</div>
						<div className="cli-welcome-actions">
							<button
								type="button"
								className="cli-onboarding-text-button"
								onClick={() => advance("invite")}
								disabled={busy}
							>
								Skip
							</button>
							<button
								type="submit"
								className="cli-onboarding-primary"
								disabled={busy || !name.trim()}
							>
								{busy ? "Saving…" : "Continue"}
							</button>
						</div>
					</form>
				)}
				{progress.step === "invite" && (
					<form
						onSubmit={(event) => void sendInvitations(event)}
						className="cli-welcome-fields"
					>
						{canInvite ? (
							<div className="cli-welcome-field">
								<div className="cli-welcome-invite-label">
									<label htmlFor="welcome-invitations">Invitations</label>
									<button
										className="cli-welcome-copy-link"
										type="button"
										disabled={busy}
										onClick={copyInviteLink}
									>
										<LinkIcon size={14} aria-hidden="true" />
										Copy invite link
									</button>
								</div>
								<textarea
									id="welcome-invitations"
									name="emails"
									placeholder="teammate@company.com, another@company.com"
									rows={4}
									value={emails}
									onChange={(event) => setEmails(event.target.value)}
									disabled={busy}
								/>
							</div>
						) : (
							<p>
								Your workspace owner or admin can invite teammates. You can
								continue to your dashboard.
							</p>
						)}
						<div className="cli-welcome-actions">
							<button
								type="button"
								className="cli-onboarding-text-button"
								onClick={() => advance("done")}
								disabled={busy}
							>
								Skip
							</button>
							<button
								type="submit"
								className="cli-onboarding-primary"
								disabled={busy}
							>
								{busy
									? "Sending…"
									: emails.trim() && canInvite
										? "Send invitations"
										: "Finish setup"}
							</button>
						</div>
					</form>
				)}
				{progress.step === "done" && snapshot.state === "completed" && (
					<button
						type="button"
						className="cli-onboarding-primary"
						onClick={onFinish}
					>
						Open your dashboard
					</button>
				)}
			</div>
		</div>
	);
}

function readProgress(key: string, snapshot: CliConnectionSnapshot): Progress {
	try {
		const parsed = ProgressSchema.safeParse(
			JSON.parse(localStorage.getItem(key) ?? "null"),
		);
		if (parsed.success) return parsed.data;
	} catch {
		/* Fall back to the server-confirmed connection state. */
	}
	return {
		step:
			snapshot.organizationId && snapshot.state !== "awaiting_login"
				? "profile"
				: "workspace",
		organizationId:
			snapshot.state === "awaiting_login" ? null : snapshot.organizationId,
	};
}
