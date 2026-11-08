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
				className="min-w-0 truncate text-left font-sans text-xs/4 font-normal tracking-normal text-[#0000009b] dark:text-[#ffffffaf]"
				data-session-overview-repository-label
				title={repositoryLabel}
			>
				{repositoryLabel}
			</p>
		);
	const place = getSessionPlace(session);
	return (
		<p
			className="flex min-w-0 items-center gap-1.5 text-left font-sans text-xs/4 font-normal tracking-normal text-[#0000009b] dark:text-[#ffffffaf]"
			data-session-overview-place
			title={place.title}
		>
			<span className="min-w-0 truncate">{place.label}</span>
			{place.remote ? null : (
				<span className="shrink-0 rounded-full bg-amber-500/12 px-1.5 text-[0.625rem]/4 text-amber-700 dark:text-amber-300">
					no remote
				</span>
			)}
		</p>
	);
}
