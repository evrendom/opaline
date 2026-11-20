import type { SessionAnalytics } from "@rudel/api-routes";
import { getRepositoryLabel } from "./sessions-overview-table-utils";

export function getSessionPlace(session: SessionAnalytics) {
	const path = session.project_path.replace(/\\/g, "/").replace(/\/+$/, "");
	const conductor = path.match(/(?:^|\/)conductor\/workspaces\/[^/]+\/([^/]+)/);
	const dotWorktree = path.match(/(?:^|\/)[^/]+\/\.worktrees\/([^/]+)/);
	const folder = path.split("/").filter(Boolean).at(-1) ?? path;
	const remote = session.git_remote?.trim() || null;
	return {
		label: conductor?.[1]
			? `Conductor · ${conductor[1]}`
			: dotWorktree?.[1]
				? `Worktree · ${dotWorktree[1]}`
				: folder || "Unknown folder",
		remote,
		title: `${session.project_path}\n${remote ?? "No git remote recorded"}`,
	};
}

export function SessionPlaceLabel({
	session,
	showPlace = false,
}: {
	session: SessionAnalytics;
	showPlace?: boolean;
}) {
	const repositoryLabel = getRepositoryLabel(session);
	if (!showPlace)
		return (
			<p
				className="min-w-0 truncate text-left font-body text-xs/4 font-regular tracking-m text-ink-3"
				data-session-overview-repository-label
				title={repositoryLabel}
			>
				{repositoryLabel}
			</p>
		);
	const place = getSessionPlace(session);
	return (
		<p
			className="flex min-w-0 items-center gap-s text-left font-body text-xs/4 font-regular tracking-m text-ink-3"
			data-session-overview-place
			title={place.title}
		>
			<span className="min-w-0 truncate">{place.label}</span>
			{place.remote ? null : (
				<span className="shrink-0 corner-full bg-warning/12 px-s text-[0.625rem]/4 text-warning">
					no remote
				</span>
			)}
		</p>
	);
}
