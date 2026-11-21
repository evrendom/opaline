import { IconFolder, IconMessages, IconUsers } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { SearchInput } from "@/components/dashboard/data-table";
import { OverviewRangeFiltersMenu } from "@/components/overview-list";
import { CostFilterChip } from "@/features/costs/cost-dashboard-page";
import { DotPickContext } from "@/features/costs/cost-hover-date";
import {
	DashboardRangeControls,
	ShellDashboardRangeControls,
} from "@/features/costs/dashboard-range-controls";
import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { RepoDetailHeader } from "@/features/repos/repo-detail-page";
import {
	type RepoReaderTab,
	RepoReaderTabs,
} from "@/features/repos/repo-reader-tabs";
import { SessionsFocusedDayTag } from "@/features/sessions/components/sessions-focused-day-tag";
import { SessionsOverviewControls } from "@/features/sessions/components/sessions-overview-controls";
import { SessionsOverviewFiltersMenu } from "@/features/sessions/components/sessions-overview-filters-menu";
import { SessionsOverviewSortMenu } from "@/features/sessions/components/sessions-overview-sort-menu";
import type { SessionOverviewRangeFilter } from "@/features/sessions/components/sessions-overview-table-utils";
import { useSessionsOverviewTableState } from "@/features/sessions/components/use-sessions-overview-table-state";
import { SiteHeader } from "@/features/shell/components/SiteHeader";
import { ShellHeaderPortalContext } from "@/features/shell/shell-header-portal";
import { Group, Specimen, State } from "./kit";
import { seed } from "./providers";

const noop = () => {};
const SESSION_ID = seed.sessions[0]?.session_id ?? "";
const REPO_KEY = "remote:github.com/acme/loomrail";

/** The sessions list's table state over the demo's sessions, as the
 *  sessions page builds it. */
function useSeedTableState(filterCatalogPending = false) {
	return useSessionsOverviewTableState({
		sessions: seed.sessions,
		sessionCountLabel: seed.sessions.length,
		totalSessionCount: seed.totalSessionCount,
		userMap: {},
		filterCatalogPending,
	});
}

/** The session list's answer in the cache, as the sessions page leaves it:
 *  the header reads a session's model from it. */
function useSeedSessionList() {
	const client = useQueryClient();
	useState(() =>
		client.setQueryData(["org", seed.organization.id, "showcase", "sessions"], {
			pages: [seed.sessions],
			pageParams: [0],
		}),
	);
}

/**
 * The real page header (SiteHeader) as a screen at `path` renders it, in a
 * window-coloured frame. `portal` renders what a page portals into the
 * header's slot (the repo breadcrumb), at the same location.
 */
function HeaderAt({
	path,
	actions,
	portal,
}: {
	path: string;
	actions?: ReactNode;
	portal?: ReactNode;
}) {
	const [host, setHost] = useState<HTMLElement | null>(null);
	return (
		<div className="dashboard-01-theme w-full overflow-hidden corner-s bg-canvas shadow-card">
			<Routes location={path}>
				<Route
					path="*"
					element={
						<>
							<SiteHeader
								actions={actions}
								setNewseshListPortalHost={noop}
								setPortalHost={setHost}
								showWorkspaceMenu={false}
							/>
							{portal ? (
								<ShellHeaderPortalContext value={host}>
									{portal}
								</ShellHeaderPortalContext>
							) : null}
						</>
					}
				/>
			</Routes>
		</div>
	);
}

/** The dashboard's range control: the date range, then the chart interval. */
export function DateRangeControl() {
	return <ShellDashboardRangeControls />;
}

/** The date range control on Sessions and Compass, without an interval. */
export function SessionsDateControl() {
	return <DashboardDateControls />;
}

/** The sessions list's "Sorted by" menu. */
export function SortControl() {
	const tableState = useSeedTableState();
	return (
		<SessionsOverviewSortMenu
			activeSortLabel={tableState.activeSortLabel}
			onSortChange={tableState.changeSort}
			options={tableState.sortOptions}
			sort={tableState.sort}
		/>
	);
}

/** The sessions list's Filter menu, as SessionsOverviewControls renders it. */
export function SessionFiltersControl({
	loading = false,
}: {
	loading?: boolean;
}) {
	const tableState = useSeedTableState(loading);
	return (
		<SessionsOverviewFiltersMenu
			variant="linear"
			isLoading={tableState.filterCatalogPending}
			excludedFilterValues={tableState.excludedFilterValues}
			filterOptions={tableState.filterOptions}
			onClearAll={tableState.clearAllFilters}
			onClearFilter={tableState.clearFilter}
			onClearRangeFilter={tableState.clearRangeFilter}
			onFilterOptionChecked={tableState.setFilterOptionChecked}
			onRangeFilterChange={tableState.setRangeFilter}
			rangeFilterBounds={tableState.rangeFilterBounds}
			rangeFilterValues={tableState.rangeFilterValues}
		/>
	);
}

// The Skills page's range filters (SkillsPageView), with the demo's spread.
const SKILL_FILTERS = [
	{ group: "activity", icon: IconMessages, key: "sessions", label: "Sessions" },
	{ group: "activity", icon: IconUsers, key: "members", label: "Members" },
	{ group: "usage", icon: IconFolder, key: "repos", label: "Repos" },
] as const;
type SkillFilterKey = (typeof SKILL_FILTERS)[number]["key"];
const NO_RANGE: SessionOverviewRangeFilter = { minimum: null, maximum: null };
const SKILL_BOUNDS = {
	sessions: { minimum: 0, maximum: 20, step: 1 },
	members: { minimum: 0, maximum: 3, step: 1 },
	repos: { minimum: 0, maximum: 3, step: 1 },
};

/** The Filter menu on Skills and Repos (a range per measure). `active`
 *  starts it with one range applied. */
export function SkillsFilterControl({
	active = false,
	disabled = false,
}: {
	active?: boolean;
	disabled?: boolean;
}) {
	const [values, setValues] = useState<
		Record<SkillFilterKey, SessionOverviewRangeFilter>
	>({
		sessions: active ? { minimum: 5, maximum: null } : NO_RANGE,
		members: NO_RANGE,
		repos: NO_RANGE,
	});
	return (
		<OverviewRangeFiltersMenu
			bounds={SKILL_BOUNDS}
			disabled={disabled}
			filters={SKILL_FILTERS}
			formatValue={(_key, value) => value.toLocaleString()}
			noun="skills"
			values={values}
			onChange={(key, value) =>
				setValues((previous) => ({ ...previous, [key]: value }))
			}
			onClearAll={() =>
				setValues({ sessions: NO_RANGE, members: NO_RANGE, repos: NO_RANGE })
			}
		/>
	);
}

function SearchSpecimen({ initial }: { initial: string }) {
	const [value, setValue] = useState(initial);
	return (
		<SearchInput
			value={value}
			onChange={setValue}
			placeholder="Search by session ID…"
			label="Search sessions by ID"
		/>
	);
}

/** The sessions list's whole toolbar, with a day picked on the dot chart. */
function SessionsToolbar() {
	const tableState = useSeedTableState();
	const [picked, setPicked] = useState<{ date: string; end: string } | null>({
		date: "2026-08-27",
		end: "2026-08-27",
	});
	return (
		<DotPickContext value={{ picked, pick: setPicked }}>
			<SessionsOverviewControls
				tableState={tableState}
				showDateControl={false}
				toolbarStart={<SearchSpecimen initial="" />}
			/>
		</DotPickContext>
	);
}

function RepoTabsSpecimen() {
	const [tab, setTab] = useState<RepoReaderTab>("summary");
	return <RepoReaderTabs ci value={tab} onChange={setTab} />;
}

export function HeaderGroup() {
	useSeedSessionList();
	return (
		<Group title="Page header and toolbar">
			<Specimen
				name="SiteHeader: section title"
				source="features/shell/components/SiteHeader.tsx"
				where="The window's top row on each section: the section's chip and title; the dashboard adds its range control at the right."
				className="flex-col items-stretch"
			>
				<HeaderAt path="/dashboard" actions={<DateRangeControl />} />
				<HeaderAt path="/session" />
				<HeaderAt path="/skills" />
				<HeaderAt path="/mcp" />
				<HeaderAt path="/repos" />
				<HeaderAt path="/compass" />
				<HeaderAt path="/settings/account" />
			</Specimen>

			<Specimen
				name="SiteHeader: session breadcrumb"
				source="features/shell/components/SiteHeader.tsx"
				where="A session's page: Sessions back to the list, the model's chip and name, the short id and its copy button. Reading a subagent, the session's parts step back."
				className="flex-col items-stretch"
			>
				<State label="the session" className="items-stretch">
					<HeaderAt path={`/session/${SESSION_ID}`} />
				</State>
				<State label="reading a subagent" className="items-stretch">
					<HeaderAt path={`/session/${SESSION_ID}?agent=1`} />
				</State>
			</Specimen>

			<Specimen
				name="RepoDetailHeader"
				source="features/repos/repo-detail-page.tsx"
				where="A repo's page: Repos back to the list, then the repo with its hue; with a session open, the repo leads back and the session id ends the crumb."
				className="flex-col items-stretch"
			>
				<State label="a repo" className="items-stretch">
					<HeaderAt
						path={`/repos?repo=${encodeURIComponent(REPO_KEY)}`}
						portal={
							<RepoDetailHeader
								repoKey={REPO_KEY}
								name="acme/loomrail"
								onBack={noop}
								sessionId={null}
								onBackToSessions={noop}
								setControls={noop}
							/>
						}
					/>
				</State>
				<State label="a session in the repo" className="items-stretch">
					<HeaderAt
						path={`/repos?repo=${encodeURIComponent(REPO_KEY)}&session=${SESSION_ID}`}
						portal={
							<RepoDetailHeader
								repoKey={REPO_KEY}
								name="acme/loomrail"
								onBack={noop}
								sessionId={SESSION_ID}
								onBackToSessions={noop}
								setControls={noop}
							/>
						}
					/>
				</State>
			</Specimen>

			<Specimen
				name="RepoReaderTabs (PillTabs, tab-pill)"
				source="features/repos/repo-reader-tabs.tsx"
				where="A repo's page, at the header row's right: Summary, Sessions, Files, Instructions, Skills, MCP, CI & PRs."
			>
				<RepoTabsSpecimen />
			</Specimen>

			<Specimen
				name="SessionsOverviewControls"
				source="features/sessions/components/sessions-overview-controls.tsx"
				where="Sessions, and a repo's Sessions tab: search by id, Sorted by, Filter, and the picked day's tag."
			>
				<SessionsToolbar />
			</Specimen>

			<Specimen
				name="SearchInput"
				source="components/dashboard/data-table.tsx"
				where="The toolbars of Sessions, Skills, MCP, Repos and a session's usage; a value shows the clear button."
			>
				<State label="empty">
					<SearchSpecimen initial="" />
				</State>
				<State label="with a value">
					<SearchSpecimen initial="01a057ef" />
				</State>
			</Specimen>

			<Specimen
				name="ToolbarSortMenu"
				source="features/sessions/components/sessions-overview-sort-menu.tsx"
				where="Sessions, Skills, MCP and Repos: the sort key, the chevron for the direction."
			>
				<State label="at rest">
					<SortControl />
				</State>
			</Specimen>

			<Specimen
				name="Filter trigger"
				source="features/sessions/components/sessions-overview-filters-menu.tsx · components/overview-list.tsx (OverviewRangeFiltersMenu)"
				where="Sessions (filters loading while the catalog loads); Skills and Repos (a count once a range applies, disabled while the list loads)."
			>
				<State label="sessions">
					<SessionFiltersControl />
				</State>
				<State label="sessions, loading">
					<SessionFiltersControl loading />
				</State>
				<State label="skills">
					<SkillsFilterControl />
				</State>
				<State label="skills, one applied">
					<SkillsFilterControl active />
				</State>
				<State label="skills, disabled">
					<SkillsFilterControl disabled />
				</State>
			</Specimen>

			<Specimen
				name="Date range control"
				source="features/costs/dashboard-range-controls.tsx · features/dashboard/components/DashboardDateControls.tsx"
				where="The dashboard's header (range · interval); Sessions' rail and Compass (range only); a repo's rail (compact)."
			>
				<State label="dashboard">
					<DateRangeControl />
				</State>
				<State label="sessions, compass">
					<SessionsDateControl />
				</State>
				<State label="repo rail, compact">
					<DashboardRangeControls
						interval="daily"
						onIntervalChange={noop}
						inHeader={false}
						compact
					/>
				</State>
			</Specimen>

			<Specimen
				name="SessionsFocusedDayTag"
				source="features/sessions/components/sessions-focused-day-tag.tsx"
				where="Sessions, after picking a day on the dot chart: a pressed toolbar pill that clears the pick."
			>
				<DotPickContext
					value={{
						picked: { date: "2026-08-27", end: "2026-08-27" },
						pick: noop,
					}}
				>
					<SessionsFocusedDayTag />
				</DotPickContext>
			</Specimen>

			<Specimen
				name="CostFilterChip (filter-chip)"
				source="features/costs/cost-dashboard-page.tsx"
				where="The dashboard's chart card header, one per active filter; a filter the charted GitHub metric ignores is dimmed."
			>
				<State label="active">
					<CostFilterChip dimension="Members" value="Evren" inactive={false} />
				</State>
				<State label="not applied to the metric">
					<CostFilterChip dimension="Models" value="Fable 5" inactive />
				</State>
			</Specimen>
		</Group>
	);
}
