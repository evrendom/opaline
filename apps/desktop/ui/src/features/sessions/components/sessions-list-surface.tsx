import type { SessionAnalytics } from "@rudel/api-routes";
import { type Ref, useState } from "react";
import { Button } from "@/app/ui/button";
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
				layout === "page" &&
					"px-xl pb-xxl pt-m sm:px-xxl lg:px-xxxl lg:pb-xxxl",
				layout === "pane" && "h-full min-h-0 overflow-y-auto p-xl sm:p-xxl",
				layout === "workspace" &&
					"flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-canvas",
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
						<p className="px-xl py-l text-body-xxl text-ink-3 sm:text-body-xl">
							Some upload errors couldn’t be loaded.{" "}
							<Button
								variant="link"
								size="inline"
								onClick={data.retryUploadFailures}
							>
								Try again
							</Button>
						</p>
					) : null}
					{isSnapshotSessionsError ? (
						<div
							className={cn(
								"edge-b-m border-line px-xxl py-xxxl text-center text-ink-3",
								layout === "page" && "text-body-xl",
								layout === "pane" && "text-body-xxl sm:text-body-xl",
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
							onSessionClick={undefined}
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
							usageShares={data.usageShares}
							// A search reads every page itself.
							pagination={
								search.active
									? { ...pagination, hasNextPage: false }
									: pagination
							}
							costMaximum={data.costMaximum}
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
