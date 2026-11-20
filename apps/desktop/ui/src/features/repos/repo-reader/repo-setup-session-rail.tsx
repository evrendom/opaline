import type {
	RepositorySetupFile,
	RepositorySetupSession,
} from "@rudel/api-routes";
import { IconArrowUpRight } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bone, Reveal } from "@/app/ui/bones";
import { FluidList, FluidListItem } from "@/components/fluid-list";
import { ScrollColumn } from "@/features/sessions/reader/files/session-reader-files-parts";
import { setupName } from "@/features/sessions/reader/setup/session-setup-files";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { cn } from "@/lib/utils";
import { type RailFilter, useRailFilter } from "./repo-rail-highlight";
import { sessionPagePath } from "./repo-run-calls";
import { RAIL_SHELF } from "./repo-runs-column";
import { useRepoSetupSessions } from "./use-repo-setup";

const when = (iso: string) =>
	new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

function shortSessionId(id: string): string {
	return id[14] === "7" ? id.slice(-6) : id.slice(0, 6);
}

export function RepoSetupSessionRail({
	file,
	repoKey,
	versionId,
	versionLabel,
}: {
	file: RepositorySetupFile;
	repoKey: string | undefined;
	versionId: string | null;
	versionLabel: string | null;
}) {
	const query = useRepoSetupSessions(repoKey, file.setupFile);
	const all = query.data?.sessions;
	const rows = useMemo(
		() => (versionId ? all?.filter((row) => row.version === versionId) : all),
		[all, versionId],
	);
	const sessions = useMemo(() => {
		const latest = new Map<string, RepositorySetupSession>();
		for (const row of rows ?? []) {
			const seen = latest.get(row.sessionId);
			if (!seen || row.lastAt > seen.lastAt) latest.set(row.sessionId, row);
		}
		return [...latest.values()].sort((a, b) =>
			b.lastAt.localeCompare(a.lastAt),
		);
	}, [rows]);
	const filter = useMemo<RailFilter>(
		() => ({
			days: null,
			figures: rows
				? {
						sessions: sessions.length,
						agentRuns: rows.reduce((sum, row) => sum + row.runs, 0),
						cost: null,
						unpricedRuns: null,
						signals: null,
						mergedPullRequests: null,
						ciRuns: null,
					}
				: null,
			focusDays: rows
				? new Set(
						rows.flatMap((row) => [
							row.firstAt.slice(0, 10),
							row.lastAt.slice(0, 10),
						]),
					)
				: undefined,
			sessionIds: rows ? sessions.map((row) => row.sessionId) : undefined,
			loading: query.isPending,
			name: versionLabel
				? `${setupName(file)} · ${versionLabel}`
				: setupName(file),
		}),
		[file, query.isPending, rows, sessions, versionLabel],
	);
	useRailFilter(filter);
	return (
		<section
			aria-label="Sessions that received it"
			className={cn(RAIL_SHELF, "w-[120px]")}
		>
			<ScrollColumn className="px-1.5 pt-2 pb-4">
				{!query.isPending && query.isError ? (
					<p className="px-2 py-2 text-xs text-muted-foreground">
						Sessions could not be read.
					</p>
				) : !query.isPending && sessions.length === 0 ? (
					<p className="px-2 py-2 text-xs text-muted-foreground">
						No session received it
					</p>
				) : (
					<Reveal
						label="Reading the sessions"
						loading={query.isPending}
						sample={
							<div className="flex flex-col gap-3 px-2 pt-1">
								{["w-3/4", "w-2/3", "w-4/5", "w-1/2"].map((width) => (
									<Bone key={width} className={cn("h-3 rounded-md", width)} />
								))}
							</div>
						}
						sampleId="repo-setup-sessions"
					>
						{() => (
							<FluidList>
								<ul className="flex flex-col gap-0.5">
									{sessions.map((session, index) => (
										<li key={session.sessionId}>
											<FluidListItem<HTMLAnchorElement> index={index}>
												{(item) => (
													<SessionLink
														file={file}
														item={item}
														repoKey={repoKey}
														session={session}
													/>
												)}
											</FluidListItem>
										</li>
									))}
								</ul>
							</FluidList>
						)}
					</Reveal>
				)}
			</ScrollColumn>
		</section>
	);
}

function SessionLink({
	file,
	item,
	repoKey,
	session,
}: {
	file: RepositorySetupFile;
	item: {
		ref: React.RefObject<HTMLAnchorElement | null>;
		onFocus: () => void;
	};
	repoKey: string | undefined;
	session: RepositorySetupSession;
}) {
	const getShellRoutePath = useShellRoutePath();
	const params = new URLSearchParams({
		sessionTab: "setup",
		setup: file.setupFile,
	});
	return (
		<Link
			ref={item.ref}
			onFocus={item.onFocus}
			to={sessionPagePath(
				getShellRoutePath,
				repoKey,
				session.sessionId,
				params,
			)}
			title={`${session.sessionId} · ${when(session.lastAt)}`}
			className="group/session relative flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium tabular-nums outline-none corner-squircle squircle:rounded-xl focus-visible:ring-2 focus-visible:ring-ring/50"
		>
			<span className="truncate">{shortSessionId(session.sessionId)}</span>
			<IconArrowUpRight
				aria-hidden="true"
				className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover/session:text-foreground group-focus-visible/session:text-foreground"
			/>
		</Link>
	);
}
