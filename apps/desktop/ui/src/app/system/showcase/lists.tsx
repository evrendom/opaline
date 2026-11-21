import type { NoticeableRun } from "@rudel/api-routes";
import { useState } from "react";
import { ListBody } from "@/features/compass/CompassPage";
import { RunRow } from "@/features/compass/compass-moments";
import { REPORT_FIXTURE } from "@/features/reports/report-fixture";
import { ReportView } from "@/features/reports/report-view";
import { ReposList } from "@/features/repos/repos-overview";
import { SessionsOverviewFluidList } from "@/features/sessions/components/sessions-overview-fluid-list";
import { SessionsOverviewPager } from "@/features/sessions/components/sessions-overview-pager";
import { SessionsOverviewRow } from "@/features/sessions/components/sessions-overview-row";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { cn } from "@/lib/utils";
import { Group, Specimen, State } from "./kit";
import { demoPortraits, seed } from "./providers";

const NOOP = () => {};
const viewer = seed.members.find(
	(member) => member.userId === seed.viewerUserId,
);
const viewerName = viewer?.name ?? "you";
const [portrait] = demoPortraits;

// A spread of the demo's sessions: plain rows, errors, apologies and praise,
// many skills, subagents.
const ROW_INDEXES = [0, 1, 6, 7, 12, 18, 2];
const rows = ROW_INDEXES.flatMap((index) => seed.sessions[index] ?? []);
const maximumSessionCost = Math.max(
	...seed.sessions.map((session) => session.estimated_cost ?? 0),
);

function SessionRows() {
	return (
		// As the Sessions page sets it (features/sessions/sessions-page.tsx):
		// beside its rail, at the list's width in a 1440px window, the place
		// shown and the skills inline.
		<div
			data-rail-beside=""
			className={cn(
				SESSION_OVERVIEW_SURFACE_CLASS_NAME,
				"w-[54.5rem] flex-none",
			)}
		>
			<div
				className="@container/sessions-overview flex flex-col"
				data-slot="sessions-overview-canvas"
			>
				<SessionsOverviewFluidList fillHeight={false}>
					{({ registerItem, setActiveIndex }) =>
						rows.map((session, index) => (
							<SessionsOverviewRow
								key={session.session_id}
								showPlace
								showSkillsColumn={false}
								index={index}
								registerItem={registerItem}
								setHoverActiveIndex={setActiveIndex}
								activeSessionId={index === 1 ? session.session_id : undefined}
								avatarUrl={portrait}
								canOpenSession={() => true}
								getSessionHref={undefined}
								getSessionLinkState={undefined}
								maximumSessionCost={maximumSessionCost}
								memberProfile={undefined}
								onSessionClick={NOOP}
								session={session}
								userLabel={viewerName}
							/>
						))
					}
				</SessionsOverviewFluidList>
			</div>
		</div>
	);
}

function Pager({ page, known }: { page: number; known: number }) {
	const [pageSize, setPageSize] = useState(30);
	return (
		<SessionsOverviewPager
			isFetching={false}
			known={known}
			more={false}
			onPage={NOOP}
			onPageSize={setPageSize}
			page={page}
			pageSize={pageSize}
			shown={Math.min(pageSize, known - page * pageSize)}
		/>
	);
}

// Runs as Compass lists them: each flag kind the demo's runs carry.
const sessionId = seed.sessions[0]?.session_id ?? "";
function run(
	turn: number,
	prompt: string | null,
	costUsd: number,
	startedAt: string,
	flags: NoticeableRun["flags"],
): NoticeableRun {
	return {
		agentId: "",
		costUsd,
		flags,
		id: `${sessionId}:${turn}`,
		minutes: 12,
		model: "gpt-5.6-sol",
		observation: null,
		prompt,
		sessionId,
		startedAt,
		turn,
		userId: seed.viewerUserId,
	};
}
const RUNS: NoticeableRun[] = [
	run(
		2,
		"Seeing this in the logs a few times an hour, can you dig in?",
		0.56,
		"2026-08-31T13:51:00Z",
		[
			{
				kind: "compaction",
				spanStart: 51,
				spanEnd: 101,
				count: 1,
				detail: "Context compacted 1× during the run",
			},
		],
	),
	run(3, "ci failed again", 1.32, "2026-08-31T11:20:00Z", [
		{
			kind: "model_apology",
			spanStart: 4,
			spanEnd: 9,
			count: 1,
			detail: "The model apologised once",
		},
	]),
	run(
		4,
		"the tests are flaky locally, can you get them green?",
		0.1,
		"2026-08-31T09:02:00Z",
		[
			{
				kind: "interrupted",
				spanStart: 1,
				spanEnd: 3,
				count: 1,
				detail: "Stopped by the member",
			},
		],
	),
	run(
		5,
		"Can you put up a preview deploy for this branch?",
		5.53,
		"2026-08-28T16:40:00Z",
		[
			{
				kind: "expensive_run",
				spanStart: 1,
				spanEnd: 120,
				count: 6,
				detail: "$5.53, 6× the median run ($0.92)",
			},
		],
	),
	run(6, null, 9.42, "2026-08-27T10:12:00Z", [
		{
			kind: "search_before_edit",
			spanStart: 1,
			spanEnd: 40,
			count: 14,
			detail: "14 searches before the first edit",
		},
		{
			kind: "expensive_run",
			spanStart: 1,
			spanEnd: 120,
			count: 10,
			detail: "$9.42, 10× the median run",
		},
		{
			kind: "long_run",
			spanStart: 1,
			spanEnd: 120,
			count: 25,
			detail: "25 min, 14× the median run",
		},
	]),
];

export function ListsGroup() {
	return (
		<Group title="Lists and tables">
			<Specimen
				name="SessionsOverviewRow (in SessionsOverviewFluidList)"
				source="features/sessions/components/sessions-overview-row.tsx"
				where="Sessions page, a repo's Sessions tab and the new-session list: cost, model mark and name, repo and branch, skill and error tags, language signals, member, day. The second row is the open session."
			>
				<SessionRows />
			</Specimen>
			<Specimen
				name="SessionsOverviewPager"
				source="features/sessions/components/sessions-overview-pager.tsx"
				where="Under the sessions list: the count, the page-size select and the previous / next buttons (outline when they can move, ghost and disabled when not)."
			>
				<State label="first page">
					<Pager page={0} known={109} />
				</State>
				<State label="a middle page">
					<Pager page={1} known={109} />
				</State>
			</Specimen>
			<Specimen
				name="ReposList (OverviewList, RepoRow, OverviewMembers)"
				source="features/repos/repos-overview.tsx · components/overview-list.tsx"
				where="Repos page: one row per repository, its negative-language and apology tags, members, sessions, tokens, cost and last activity."
			>
				<div className="w-full">
					<ReposList
						avatarMap={{ [seed.viewerUserId]: portrait }}
						getRepoHref={() => "#"}
						repos={seed.repositories}
						userMap={{ [seed.viewerUserId]: viewerName }}
					/>
				</div>
			</Specimen>
			<Specimen
				name="RunRow (in ListBody)"
				source="features/compass/compass-moments.tsx · features/compass/CompassPage.tsx"
				where="Compass, the Runs list: the lead flag's glyph, the prompt (or the flags when the run has none), flags and member, cost and day. The first row is the selected run."
			>
				<div className="compass-page flex w-[25rem] flex-col">
					<ListBody>
						{RUNS.map((item, index) => (
							<RunRow
								key={item.id}
								run={item}
								selected={index === 0}
								onSelect={NOOP}
								onKeyDown={NOOP}
							/>
						))}
					</ListBody>
				</div>
			</Specimen>
			<Specimen
				name="ReportView (Badge, Table)"
				source="features/reports/report-view.tsx"
				where="A saved analysis (/<workspace>/reports/<id>): the shared/private badge, the Health actions and signals tables and each step's result table."
			>
				<div className="w-full">
					<ReportView
						report={REPORT_FIXTURE}
						authorName={viewerName}
						workspaceSlug={seed.organization.slug}
					/>
				</div>
			</Specimen>
		</Group>
	);
}
