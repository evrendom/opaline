import type { SessionAnalytics } from "@rudel/api-routes";
import { type Ref, useState } from "react";
import { SearchInput } from "@/components/dashboard/data-table";
import { orderSessionsForDisplay } from "@/features/sessions/session-ordering";
import { useSessionIdSearch } from "@/features/sessions/use-session-id-search";
import type { SessionsPageData } from "@/features/sessions/use-sessions-page-data";
import { cn } from "@/lib/utils";
import { SessionsOverviewTable } from "./sessions-overview-table";

type SessionsListSurfaceProps = {
	activeSessionId: string | null;
	canOpenSession: (session: SessionAnalytics) => boolean;
	data: SessionsPageData;
	getSessionHref?: (session: SessionAnalytics) => string;
	getSessionLinkState?: (session: SessionAnalytics) => unknown;
	layout: "page" | "pane" | "workspace";
	onSessionClick: (session: SessionAnalytics) => void;
	scrollContainerRef?: Ref<HTMLDivElement>;
	showPlace?: boolean;
	showSkillsColumn?: boolean;
};

export function SessionsListSurface({
	activeSessionId,
	canOpenSession,
	data,
	getSessionHref,
	getSessionLinkState,
	layout,
	onSessionClick,
	scrollContainerRef,
	showPlace,
	showSkillsColumn,
}: SessionsListSurfaceProps) {
	const {
		endDate,
		startDate,
		isSnapshotSessionsError,
		isSnapshotSessionsPending,
		orderedSessions,
		totalSessionCount,
		pagination,
	} = data;
	const [idSearch, setIdSearch] = useState("");
	const search = useSessionIdSearch({
		search: idSearch,
		input: data.listInput,
		fallback: orderedSessions,
	});
	const sessions = search.active
		? orderSessionsForDisplay({
				sessions: search.sessions,
				useRolling24Hours: data.useRolling24Hours,
			})
		: orderedSessions;

	return (
		<div
			className={cn(
				"dashboardy-page min-w-0 overscroll-x-none",
				layout === "page" && "px-4 pb-6 pt-2 sm:px-6 lg:px-[76px] lg:pb-8",
				layout === "pane" && "h-full min-h-0 overflow-y-auto p-4 sm:p-5",
				layout === "workspace" &&
					"flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[color:var(--dashboardy-surface-opaque)]",
			)}
		>
			<div
				className={cn(
					"flex w-full min-w-0 flex-col",
					// Workspace tables size against the whole workspace, not the split pane.
					layout !== "workspace" && "@container/dashboard-page",
					layout === "workspace" && "min-h-0 flex-1 overflow-hidden",
				)}
			>
				<div
					className={cn(
						"flex min-w-0 flex-col",
						layout === "workspace" && "min-h-0 flex-1 overflow-hidden",
					)}
				>
					{data.uploadFailuresError ? (
						<p className="px-4 py-3 text-base text-(--dashboardy-muted) sm:text-sm">
							Some upload errors couldn’t be loaded.{" "}
							<button
								type="button"
								className="underline"
								onClick={data.retryUploadFailures}
							>
								Try again
							</button>
						</p>
					) : null}
					{isSnapshotSessionsError ? (
						<div
							className={cn(
								"border-b border-black/6 px-6 py-12 text-center text-[color:var(--dashboardy-muted)] dark:border-white/8",
								layout === "page" && "text-sm",
								layout === "pane" && "text-base sm:text-sm",
							)}
						>
							We couldn&apos;t load the session overview for this range.
						</div>
					) : (
						<SessionsOverviewTable
							key={`${data.organizationId}:${startDate}:${endDate}`}
							activeSessionId={activeSessionId}
							canOpenSession={canOpenSession}
							getSessionHref={getSessionHref}
							getSessionLinkState={getSessionLinkState}
							isLoading={isSnapshotSessionsPending}
							onSessionClick={onSessionClick}
							showPlace={showPlace}
							showSkillsColumn={showSkillsColumn}
							sessionCountLabel={
								search.active ? (sessions?.length ?? 0) : totalSessionCount
							}
							sessions={sessions}
							toolbarStart={
								<SearchInput
									value={idSearch}
									onChange={setIdSearch}
									placeholder="Search by session ID…"
									label="Search sessions by ID"
								/>
							}
							scrollContainerRef={scrollContainerRef}
							sessionDetailDisabledNote={undefined}
							totalSessionCount={totalSessionCount}
							// A search reads every page itself.
							pagination={
								search.active
									? { ...pagination, hasNextPage: false }
									: pagination
							}
							filterCatalog={data.filterCatalog}
							filterCatalogPending={data.filterCatalogPending}
							filterCatalogError={data.filterCatalogError}
							onRetryFilterCatalog={data.retryFilterCatalog}
							onFiltersChange={data.setSessionFilters}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
