// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: Cohesive table interaction coverage is intentionally kept in one harness.
import type { LiveSessionSummary, SessionAnalytics } from "@rudel/api-routes";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, describe, expect, it, vi } from "vitest";
import { liveSessionRow } from "../live-session-rows";
import { SessionsOverviewTable } from "./sessions-overview-table";

vi.stubGlobal("PointerEvent", MouseEvent);

vi.mock("@/features/dashboard/components/DashboardDateControls", () => ({
	DashboardDateControls: () => <button type="button">Date range</button>,
}));

// The tags read through react-query, which this harness does not provide.
vi.mock("@/features/sessions/use-run-question-tags", () => ({
	useSessionRunQuestionTags: () => new Map(),
}));

vi.mock("@/features/costs/plan-usage/use-session-usage-shares", () => ({
	useSessionUsageShares: () => null,
}));

vi.mock("@/features/desktop/local-app", () => ({
	useLocalDesktopApp: () => false,
}));

vi.mock("@/features/workspace/hooks/useUserMap", () => ({
	useUserMap: () => ({
		avatarMap: {},
		isLoading: false,
		userMap: { "user-1": "Evren", "user-2": "Ada" },
	}),
}));

const session: SessionAnalytics = {
	duration_min: 12,
	error_count: 3,
	estimated_cost: 0.08,
	git_branch: "rudel/pr2-usage-events",
	input_tokens: 6_000,
	model_used: "claude-sonnet-4",
	output_tokens: 4_000,
	project_path: "/Users/evren/rudel",
	repository: "obsessiondb/rudel",
	repository_identity: {
		repoKey: "remote:github.com/obsessiondb/rudel",
		repoLabel: "obsessiondb/rudel",
		repoName: "rudel",
		source: "remote",
		worktree: null,
	},
	worktree: "podgorica",
	session_date: "2026-05-04T10:00:00.000Z",
	session_id: "session-1",
	skills: ["testing-bun", "typescript-standards", "ui", "skill-d"],
	slash_commands: [],
	subagent_types: [],
	subagent_count: 2,
	total_interactions: 6,
	total_tokens: 10_000,
	user_id: "user-1",
	member_swears: 2,
	member_swear_matches: ["fuck"],
	member_apologies: 0,
	member_apology_matches: [],
	member_positive: 0,
	member_positive_matches: [],
	model_swears: 0,
	model_swear_matches: [],
	model_apologies: 0,
	model_apology_matches: [],
	model_positive: 1,
	model_positive_matches: ["Great work"],
};

const otherSession: SessionAnalytics = {
	...session,
	git_branch: "",
	input_tokens: 8_000,
	output_tokens: 1_000,
	total_tokens: 9_000,
	error_count: 0,
	estimated_cost: 0.04,
	model_used: "gpt-5",
	repository: "openai/codex",
	repository_identity: {
		repoKey: "remote:github.com/openai/codex",
		repoLabel: "openai/codex",
		repoName: "codex",
		source: "remote",
		worktree: null,
	},
	session_id: "session-2",
	skills: [],
	subagent_count: 0,
	user_id: "user-2",
	worktree: null,
};

describe("SessionsOverviewTable", () => {
	it("lists a session running right now first, loading in its model silhouette, with how long ago it moved", () => {
		const live: LiveSessionSummary = {
			sessionId: "live-1",
			userId: "user-2",
			source: "claude_code",
			projectPath: "/Users/evren/live",
			gitRemote: "git@github.com:obsessiondb/live.git",
			gitBranch: "live/branch",
			startedAt: new Date(Date.now() - 600_000).toISOString(),
			lastActivityAt: new Date(Date.now() - 12_000).toISOString(),
			endedAt: null,
		};
		const onSessionClick = vi.fn();
		render(
			<SessionsOverviewTable
				activeSessionId={null}
				canOpenSession={() => true}
				getSessionHref={undefined}
				getSessionLinkState={undefined}
				isLoading={false}
				onSessionClick={onSessionClick}
				scrollContainerRef={undefined}
				sessionCountLabel={2}
				sessions={[session, liveSessionRow(live)]}
				sessionDetailDisabledNote={undefined}
				totalSessionCount={2}
			/>,
		);

		const sessionsList = screen.getByRole("list", { name: "Recent sessions" });
		const rows =
			sessionsList.querySelectorAll<HTMLElement>("[data-session-key]");
		expect(rows).toHaveLength(2);
		const liveRow = rows[0];
		assert(liveRow);
		expect(liveRow).toHaveAttribute("data-session-key", "claude_code:live-1");
		expect(liveRow).toHaveAttribute("data-session-live", "running");
		expect(rows[1]?.getAttribute("data-session-key")).toMatch(/:session-1$/);
		fireEvent.click(within(liveRow).getByRole("button"));
		expect(onSessionClick).toHaveBeenCalledWith(
			expect.objectContaining({ live_session: live, session_id: "live-1" }),
		);
		expect(
			liveRow.querySelector("[data-session-model-loading]"),
		).not.toBeNull();
		expect(liveRow.querySelector("[data-session-model-progress]")).toBeNull();
		expect(within(liveRow).getByText("Live")).toBeVisible();
		expect(within(liveRow).getByText("Claude Code")).toBeVisible();
		expect(within(liveRow).getByText("live")).toBeVisible();
		expect(within(liveRow).getByText("branch")).toBeInTheDocument();
		const activity = liveRow.querySelector("time");
		assert(activity);
		expect(activity).toHaveTextContent(/^1[0-9]s ago$/);
		expect(
			activity.getAttribute("data-session-overview-date-tooltip-label"),
		).toMatch(/^Started .+ · active 1[0-9]s ago$/);
		const cost = liveRow.querySelector<HTMLElement>(
			'[data-session-overview-metric-value="cost"]',
		);
		assert(cost);
		expect(cost).toHaveTextContent("—");
		expect(cost).toHaveAttribute(
			"data-session-overview-token-tooltip-label",
			"Usage arrives with the session's upload",
		);
		expect(rows[1]?.querySelector("[data-session-model-loading]")).toBeNull();
	});

	it("keeps cost first, date after the member, and cost progress in the model silhouette", () => {
		render(
			<SessionsOverviewTable
				activeSessionId={null}
				canOpenSession={() => true}
				getSessionHref={undefined}
				getSessionLinkState={undefined}
				isLoading={false}
				onSessionClick={vi.fn()}
				scrollContainerRef={undefined}
				sessionCountLabel={1}
				sessions={[session]}
				sessionDetailDisabledNote={undefined}
				totalSessionCount={1}
			/>,
		);

		const header = document.querySelector<HTMLElement>(
			'[data-slot="sessions-overview-header"]',
		);
		assert(header);
		for (const hiddenLabel of [
			"Repository",
			"Member",
			"Model",
			"Signals",
			"Subagents",
			"Errors",
			"Skills",
			"Input",
			"Output",
			"Input / Output",
			"API Cost",
		]) {
			expect(within(header).queryByText(hiddenLabel)).not.toBeInTheDocument();
			expect(
				within(header).queryByRole("button", {
					name: `Sort by ${hiddenLabel}, ascending`,
				}),
			).not.toBeInTheDocument();
		}
		const inertHeaderCells = header.querySelectorAll<HTMLElement>(
			'[data-slot="sessions-overview-inert-header-cell"]',
		);
		expect(inertHeaderCells).toHaveLength(5);
		for (const cell of inertHeaderCells) {
			expect(cell).toHaveClass("pointer-events-none", "select-none");
			expect(cell).toHaveAttribute("aria-hidden", "true");
			expect(within(cell).queryByRole("button")).not.toBeInTheDocument();
		}
		expect(
			within(header).getByRole("button", {
				name: "Sort sessions, Date, descending",
			}),
		).toBeInTheDocument();

		const sessionsList = screen.getByRole("list", { name: "Recent sessions" });
		const sessionDate = sessionsList.querySelector("time");
		assert(sessionDate);
		expect(sessionDate).toHaveTextContent("May 4");
		expect(sessionDate.parentElement).not.toHaveTextContent("12m");
		expect(sessionDate).not.toHaveAttribute("title");
		expect(
			sessionDate.getAttribute("data-session-overview-date-tooltip-label"),
		).toMatch(/^May 4, \d{2}:\d{2} (AM|PM) · 12m$/);
		const modelMark = sessionsList.querySelector(
			"[data-session-detail-model-mark]",
		);
		assert(modelMark);
		expect(modelMark).toHaveClass("drop-shadow-[0_0_0.75px_rgb(0_0_0_/_14%)]");
		const modelGlyph = modelMark.querySelector(
			'[data-trace-icon-tone="claude"]',
		);
		assert(modelGlyph);
		expect(modelGlyph).toHaveClass("text-[#D97757]");
		expect(
			modelGlyph.querySelector('[style*="--opal-tint: #D97757"]'),
		).toBeInTheDocument();
		expect(within(sessionsList).getByText("fuck")).toBeVisible();
		expect(within(sessionsList).getByText("Great work")).toBeVisible();
		expect(within(sessionsList).getByText("pr2-usage-events")).toBeVisible();
		expect(
			within(sessionsList).queryByText("rudel/pr2-usage-events"),
		).not.toBeInTheDocument();
		expect(
			within(sessionsList).queryByText("I 6K / O 4K"),
		).not.toBeInTheDocument();
		const modelCell = sessionsList.querySelector<HTMLElement>(
			'[data-session-overview-column="model"]',
		);
		assert(modelCell);
		expect(within(modelCell).getAllByRole("progressbar")).toHaveLength(1);
		expect(modelCell.nextElementSibling).toHaveAttribute(
			"data-session-overview-column",
			"skills",
		);
		const memberCell = modelCell.nextElementSibling?.nextElementSibling;
		assert(memberCell);
		expect(memberCell).toHaveAttribute("data-session-overview-column", "user");
		expect(memberCell).toHaveClass("justify-end", "gap-2");
		expect(memberCell.firstElementChild).toHaveAttribute(
			"data-language-signal-speaker",
			"member",
		);
		expect(memberCell.lastElementChild).toHaveAttribute(
			"data-slot",
			"session-member-profile-trigger",
		);
		expect(memberCell.firstElementChild?.nextElementSibling).toBe(
			memberCell.lastElementChild,
		);
		expect(
			sessionsList.querySelector('[data-session-overview-column="tokens"]'),
		).toBeNull();
		expect(
			sessionsList.querySelector("[data-session-overview-metric-tag]"),
		).toBeNull();
		const cost = sessionsList.querySelector<HTMLElement>(
			'[data-session-overview-metric-value="cost"]',
		);
		assert(cost);
		expect(cost).toHaveTextContent("8¢");
		expect(within(cost).queryByRole("progressbar")).not.toBeInTheDocument();
		expect(cost.parentElement).toHaveAttribute(
			"data-session-overview-column",
			"cost",
		);
		expect(cost.parentElement?.nextElementSibling).toBe(modelCell);
		expect(sessionDate.parentElement).toHaveAttribute(
			"data-session-overview-column",
			"time",
		);
		expect(sessionDate.parentElement?.previousElementSibling).toBe(memberCell);
		expect(sessionDate.parentElement?.nextElementSibling).toBeNull();
		const chart = within(modelCell).getByRole("progressbar");
		expect(chart).toBe(modelMark.previousElementSibling);
		expect(chart).toHaveAttribute("data-session-model-background");
		expect(chart.parentElement?.children).toHaveLength(2);
		expect(chart.children).toHaveLength(1);
		expect(chart).toHaveClass("text-[#CC7D5E]");
		expect(chart.querySelector("path")).toHaveAttribute(
			"stroke-linecap",
			"round",
		);
		expect(chart.querySelector("path")).toHaveAttribute("stroke-width", "3");
		expect(chart.querySelector("path")).not.toHaveAttribute("stroke-dasharray");
		expect(cost).toHaveClass("text-xs", "font-normal", "text-[#787774]");
		expect(cost).not.toHaveAttribute("data-slot");
		expect(cost).toHaveAttribute(
			"data-session-overview-token-tooltip-label",
			"Input: 6K / Output: 4K",
		);
		expect(cost.previousElementSibling).toBeNull();
		expect(
			sessionsList.querySelector("[data-session-overview-date-cost-separator]"),
		).toBeNull();
		expect(cost.closest("[data-session-overview-metric-tag]")).toBeNull();
		expect(cost.querySelector("[title]")).toBeNull();
		expect(
			cost.querySelector('[data-session-overview-metric-value="tokens"]'),
		).toBeNull();
		expect(
			sessionsList.querySelector('[data-session-overview-column="repository"]'),
		).toBeNull();
		const repositoryLabel = modelCell.querySelector(
			"[data-session-overview-repository-label]",
		);
		expect(repositoryLabel).toHaveClass(
			"text-[#0000009b]",
			"text-xs/4",
			"font-normal",
			"truncate",
			"text-left",
		);
		expect(repositoryLabel).not.toHaveAttribute("dir");
		expect(repositoryLabel).toHaveAttribute("title", "rudel");
		expect(repositoryLabel).not.toHaveClass("max-w-28");
		assert(repositoryLabel);
		expect(repositoryLabel.parentElement).toHaveClass("gap-1.5");
		expect(repositoryLabel.previousElementSibling).toHaveAttribute(
			"data-session-overview-model-label",
		);
		expect(
			modelCell.querySelector(
				"[data-session-overview-model-repository-separator]",
			),
		).toBeNull();
		const branchLabel = modelCell.querySelector(
			"[data-session-overview-branch-label]",
		);
		expect(branchLabel).toHaveClass(
			"text-[#00000044]",
			"text-xs/4",
			"font-normal",
			"tabular-nums",
			"truncate",
			"text-left",
		);
		expect(branchLabel).not.toHaveClass("flex-1");
		expect(branchLabel).not.toHaveClass("max-w-40");
		expect(branchLabel).toHaveAttribute("dir", "rtl");
		expect(branchLabel).toHaveAttribute("title", "pr2-usage-events");
		assert(branchLabel);
		expect(branchLabel.previousElementSibling).toBe(repositoryLabel);
		expect(
			modelCell.querySelector(
				"[data-session-overview-repository-branch-separator]",
			),
		).toBeNull();
		expect(within(modelCell).getByText("pr2-usage-events")).toHaveAttribute(
			"dir",
			"ltr",
		);
		expect(within(sessionsList).getByText("8¢")).toBeVisible();
		expect(
			within(sessionsList).getByRole("progressbar", {
				name: "8¢ API cost relative to the most expensive session",
			}),
		).toHaveAttribute("aria-valuenow", "100");
	});

	it("keeps unavailable costs and error counts unknown", () => {
		const incompleteCostSession: SessionAnalytics = {
			...session,
			estimated_cost: null,
			error_count: undefined,
			session_id: "session-incomplete-cost",
			skills: ["a", "b"],
			subagent_count: undefined,
			subagent_types: ["Explore", "Plan"],
		};

		render(
			<SessionsOverviewTable
				activeSessionId={null}
				canOpenSession={() => true}
				getSessionHref={undefined}
				getSessionLinkState={undefined}
				isLoading={false}
				onSessionClick={vi.fn()}
				scrollContainerRef={undefined}
				sessionCountLabel={1}
				sessions={[incompleteCostSession]}
				sessionDetailDisabledNote={undefined}
				totalSessionCount={1}
			/>,
		);

		const sessionsList = screen.getByRole("list", { name: "Recent sessions" });
		expect(
			within(sessionsList).getByText("API cost unavailable").parentElement,
		).toHaveTextContent("—");
		expect(
			within(sessionsList).getByTitle("Error count unavailable"),
		).toHaveTextContent("—");
		expect(
			within(sessionsList).queryByTitle("0 detected tool/API errors"),
		).not.toBeInTheDocument();
		expect(
			within(sessionsList).queryByRole("progressbar", { name: /API cost/ }),
		).not.toBeInTheDocument();
		expect(
			within(sessionsList).queryByTitle("2 subagents spawned"),
		).not.toBeInTheDocument();
		const skillsCell = within(sessionsList).getByTitle("a, b");
		const skillTags = skillsCell.querySelectorAll(
			"[data-session-overview-skill-tag]",
		);
		expect(skillTags).toHaveLength(2);
		expect(skillTags[0]).toHaveTextContent("a");
		expect(skillTags[1]).toHaveTextContent("b");
		for (const skillTag of skillTags) {
			expect(skillTag).toHaveAttribute("data-trace-tag-context", "sparkle");
			expect(
				skillTag.querySelector("[data-session-overview-skill-name]"),
			).toHaveClass("font-sans");
		}
	});

	it("scrolls every column together without frozen cells", () => {
		render(
			<SessionsOverviewTable
				activeSessionId={null}
				canOpenSession={() => true}
				getSessionHref={undefined}
				getSessionLinkState={undefined}
				isLoading={false}
				onSessionClick={vi.fn()}
				scrollContainerRef={undefined}
				sessionCountLabel={2}
				sessions={[session, otherSession]}
				sessionDetailDisabledNote={undefined}
				totalSessionCount={2}
			/>,
		);

		const header = document.querySelector<HTMLElement>(
			'[data-slot="sessions-overview-header"]',
		);
		const firstRow = document.querySelector<HTMLElement>(
			'[data-dashboard-grid-row-scope="session"]',
		);
		assert(header);
		assert(firstRow);
		expect(header.children[0]).not.toHaveClass("sticky");
		expect(header.children[1]).not.toHaveClass("sticky");
		expect(firstRow.children[0]).not.toHaveClass("sticky");
		expect(firstRow.children[1]).not.toHaveClass("sticky");
		expect(firstRow.children).toHaveLength(5);
		expect(
			screen.getByRole("progressbar", {
				name: "8¢ API cost relative to the most expensive session",
			}),
		).toHaveAttribute("aria-valuenow", "100");
		expect(
			screen.getByRole("progressbar", {
				name: "4¢ API cost relative to the most expensive session",
			}),
		).toHaveAttribute("aria-valuenow", "50");
		expect(
			within(header).queryByRole("button", { name: /Sort by Input/ }),
		).not.toBeInTheDocument();
		expect(
			document.querySelector(
				'[data-slot="sessions-overview-frozen-edge-shadow"]',
			),
		).not.toBeInTheDocument();
	});

	it("filters rows by model and clears the active filter", async () => {
		const user = userEvent.setup();

		render(
			<SessionsOverviewTable
				activeSessionId={null}
				canOpenSession={() => true}
				getSessionHref={undefined}
				getSessionLinkState={undefined}
				isLoading={false}
				onSessionClick={vi.fn()}
				scrollContainerRef={undefined}
				sessionCountLabel={2}
				sessions={[session, otherSession]}
				sessionDetailDisabledNote={undefined}
				totalSessionCount={2}
			/>,
		);

		expect(
			screen.queryByRole("button", { name: /Filter by/ }),
		).not.toBeInTheDocument();
		const filterButton = screen.getByRole("button", {
			name: "Filter sessions",
		});
		const controls = filterButton.closest<HTMLElement>(
			'[data-slot="sessions-overview-controls"]',
		);
		expect(controls).not.toBeNull();
		assert(controls);
		const tableHeader = controls.closest<HTMLElement>(
			'[data-slot="sessions-overview-header"]',
		);
		expect(tableHeader).not.toBeNull();
		expect(controls.children).toHaveLength(3);
		const titleRowButtons = within(controls).getAllByRole("button");
		expect(titleRowButtons).toHaveLength(3);
		// Sort and filter lead; the date range trails at the right.
		expect(titleRowButtons[0]).toHaveAccessibleName(/^Sort sessions, /);
		expect(titleRowButtons[1]).toHaveAccessibleName("Filter sessions");
		expect(titleRowButtons[2]).toHaveTextContent("Date range");

		await user.click(filterButton);
		for (const filterLabel of [
			"Repository",
			"Member",
			"Model",
			"Length",
			"Tokens",
			"Cost",
			"Errors",
			"Skills",
			"Subagent types",
		]) {
			expect(
				screen.getByRole("button", {
					name: `Configure ${filterLabel} filter`,
				}),
			).toBeInTheDocument();
		}
		await user.click(
			screen.getByRole("button", { name: "Configure Model filter" }),
		);
		await user.click(screen.getByRole("checkbox", { name: "gpt-5" }));

		const sessionsList = screen.getByRole("list", { name: "Recent sessions" });
		expect(
			screen.queryByRole("button", {
				name: "Sort by Skills, ascending",
			}),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /Sort by Subagents/ }),
		).not.toBeInTheDocument();
		const skillsCell = within(sessionsList).getByTitle(
			"testing-bun, typescript-standards, ui, skill-d",
		);
		const skillTags = skillsCell.querySelectorAll(
			"[data-session-overview-skill-tag]",
		);
		// Extra slots are prerendered but CSS-hidden until the table is wide enough.
		expect(skillTags).toHaveLength(4);
		expect(skillTags[0]).toHaveTextContent("testing-bun");
		expect(skillTags[1]).toHaveTextContent("typescript-standards");
		expect(skillTags[2]).toHaveTextContent("ui");
		expect(skillTags[3]).toHaveTextContent("skill-d");
		expect(skillTags[3]?.parentElement).toHaveClass(
			"hidden",
			"@min-[1800px]/sessions-overview:inline-flex",
		);
		expect(
			skillsCell.querySelector("[data-session-overview-skill-overflow-tag]"),
		).toHaveTextContent("+1");
		expect(
			within(sessionsList).queryByTitle("2 subagents spawned"),
		).not.toBeInTheDocument();
		expect(within(sessionsList).getByText("rudel")).toBeVisible();
		expect(within(sessionsList).queryByText("codex")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", {
				name: "Filter sessions, 1 active",
			}),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Clear all filters" }));

		expect(within(sessionsList).getByText("codex")).toBeVisible();
		const emptySkillsCell = within(sessionsList)
			.getByText("codex")
			.closest('[data-dashboard-grid-row-scope="session"]')
			?.querySelector('[data-session-overview-column="skills"]');
		assert(emptySkillsCell);
		expect(emptySkillsCell).toBeEmptyDOMElement();
		const noBranchRow = emptySkillsCell.closest(
			'[data-dashboard-grid-row-scope="session"]',
		);
		assert(noBranchRow);
		expect(
			noBranchRow.querySelector("[data-session-overview-branch-label]"),
		).toBeNull();
		expect(
			noBranchRow.querySelector(
				"[data-session-overview-repository-branch-separator]",
			),
		).toBeNull();
		await user.click(screen.getByRole("button", { name: "Filter sessions" }));

		expect(within(sessionsList).getAllByRole("listitem")).toHaveLength(2);
	});

	it("hides worktree names from rows and the repository filter", async () => {
		const user = userEvent.setup();
		assert(session.repository_identity);
		const lansingSession = {
			...session,
			project_path: "/Users/x/conductor/workspaces/obsessiondb/rudel/lansing",
			repository_identity: {
				...session.repository_identity,
				worktree: "lansing",
			},
			session_id: "session-lansing",
			worktree: "lansing",
		};

		render(
			<SessionsOverviewTable
				activeSessionId={null}
				canOpenSession={() => true}
				getSessionHref={undefined}
				getSessionLinkState={undefined}
				isLoading={false}
				onSessionClick={vi.fn()}
				scrollContainerRef={undefined}
				sessionCountLabel={2}
				sessions={[session, lansingSession]}
				sessionDetailDisabledNote={undefined}
				totalSessionCount={2}
			/>,
		);

		const sessionsList = screen.getByRole("list", { name: "Recent sessions" });
		expect(within(sessionsList).getAllByText("rudel")).toHaveLength(2);
		expect(within(sessionsList).getAllByTitle("rudel")).toHaveLength(2);
		expect(
			within(sessionsList).queryByText(/podgorica/),
		).not.toBeInTheDocument();
		expect(within(sessionsList).queryByText(/lansing/)).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		await user.click(
			screen.getByRole("button", { name: "Configure Repository filter" }),
		);
		expect(
			screen.queryByRole("checkbox", { name: "podgorica" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("checkbox", { name: "lansing" }),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("checkbox", { name: "rudel" }));
		expect(
			screen.getByText("No sessions match the selected filters."),
		).toBeVisible();
		expect(
			screen.queryByRole("list", { name: "Recent sessions" }),
		).not.toBeInTheDocument();
	});

	it("disambiguates and independently filters duplicate repository basenames", async () => {
		const user = userEvent.setup();
		const ownerASession: SessionAnalytics = {
			...session,
			repository: "owner-a/api",
			repository_identity: {
				repoKey: "remote:github.com/owner-a/api",
				repoLabel: "owner-a/api",
				repoName: "api",
				source: "remote",
				worktree: null,
			},
		};
		const ownerBSession: SessionAnalytics = {
			...otherSession,
			repository: "owner-b/api",
			repository_identity: {
				repoKey: "remote:github.com/owner-b/api",
				repoLabel: "owner-b/api",
				repoName: "api",
				source: "remote",
				worktree: null,
			},
		};

		render(
			<SessionsOverviewTable
				activeSessionId={null}
				canOpenSession={() => true}
				getSessionHref={undefined}
				getSessionLinkState={undefined}
				isLoading={false}
				onSessionClick={vi.fn()}
				scrollContainerRef={undefined}
				sessionCountLabel={2}
				sessions={[ownerASession, ownerBSession]}
				sessionDetailDisabledNote={undefined}
				totalSessionCount={2}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		await user.click(
			screen.getByRole("button", { name: "Configure Repository filter" }),
		);
		await user.click(
			screen.getByRole("checkbox", { name: "api (owner-a/api)" }),
		);

		const sessionsList = screen.getByRole("list", { name: "Recent sessions" });
		expect(
			within(sessionsList).getByLabelText("Session owner: Ada"),
		).toBeVisible();
		expect(
			within(sessionsList).queryByLabelText("Session owner: Evren"),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("checkbox", { name: "api (owner-b/api)" }),
		).toBeChecked();
	});

	it("filters sessions by skill and a numeric min/max range", async () => {
		const user = userEvent.setup();

		render(
			<SessionsOverviewTable
				activeSessionId={null}
				canOpenSession={() => true}
				getSessionHref={undefined}
				getSessionLinkState={undefined}
				isLoading={false}
				onSessionClick={vi.fn()}
				scrollContainerRef={undefined}
				sessionCountLabel={2}
				sessions={[session, otherSession]}
				sessionDetailDisabledNote={undefined}
				totalSessionCount={2}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		await user.click(
			screen.getByRole("button", { name: "Configure Skills filter" }),
		);
		await user.click(screen.getByRole("checkbox", { name: "ui" }));

		let sessionsList = screen.getByRole("list", { name: "Recent sessions" });
		expect(within(sessionsList).getByText("codex")).toBeVisible();
		expect(within(sessionsList).queryByText("rudel")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Clear all filters" }));
		await user.click(
			screen.getByRole("button", {
				name: "Configure Errors filter",
			}),
		);
		const minimumErrors = screen.getByRole("slider", {
			name: "Minimum Errors",
		});
		const maximumErrors = screen.getByRole("slider", {
			name: "Maximum Errors",
		});
		expect(minimumErrors).toHaveClass("slider-range-input-native");
		expect(maximumErrors).toHaveClass("slider-range-input-native");
		fireEvent.change(minimumErrors, { target: { value: "1" } });

		sessionsList = screen.getByRole("list", { name: "Recent sessions" });
		expect(within(sessionsList).getByText("rudel")).toBeVisible();
		expect(within(sessionsList).queryByText("codex")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", {
				name: "Filter sessions, 1 active",
			}),
		).toBeInTheDocument();
	});
});
