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
				// design-escape-ok(colour): shipped value; #0000009b (#ffffffaf in dark)
				className="min-w-0 truncate text-left font-body text-body-m font-regular tracking-m text-[#0000009b] dark:text-[#ffffffaf]"
				data-session-overview-repository-label
				title={repositoryLabel}
			>
				{repositoryLabel}
			</p>
		);
	const place = getSessionPlace(session);
	return (
		<p
			// design-escape-ok(colour): shipped value; #0000009b (#ffffffaf in dark)
			className="flex min-w-0 items-center gap-s text-left font-body text-body-m font-regular tracking-m text-[#0000009b] dark:text-[#ffffffaf]"
			data-session-overview-place
			title={place.title}
		>
			<span className="min-w-0 truncate">{place.label}</span>
			{place.remote ? null : (
				<span
					// design-escape-ok(colour,type): shipped value; amber-500/12, amber-700 (amber-300 in dark), 10/16
					className="shrink-0 corner-full bg-amber-500/12 px-s text-[0.625rem]/4 text-amber-700 dark:text-amber-300"
				>
					no remote
				</span>
			)}
		</p>
	);
}
