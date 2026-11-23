import type {
	CostDashboard,
	DashboardMetric,
	HistoricalSkillSummary,
	RepositoryMcpTool,
} from "@rudel/api-routes";
import { CostBreakdown } from "@/features/costs/cost-breakdown";
import { CostChart } from "@/features/costs/cost-chart";
import { listDashboardTabs, METRIC_LABELS } from "@/features/costs/cost-format";
import type { MetricPreviews } from "@/features/costs/use-metric-previews";
import { McpCardsGrid } from "@/features/mcp/mcp-page-view";
import {
	calledOnly,
	mcpServers,
} from "@/features/repos/repo-reader/repo-mcp-servers";
import { SkillCardsGrid } from "@/features/skills/components/skill-cards";
import "@/features/costs/cost-dashboard.css";
import { Group, Specimen, State } from "./kit";
import { seed } from "./providers";

const NOOP = () => {};

// The dashboard answer as the demo caches it: every stat card's metric merged
// into the charted answer (features/demo/demo-root.tsx, demoSeedQueries).
const answers = [seed.dashboard, ...seed.previews];
const dashboard: CostDashboard = {
	...seed.dashboard.data,
	metrics: {
		...seed.dashboard.data.metrics,
		...Object.fromEntries(
			answers
				.filter(({ input }) => input.splitBy === "none")
				.map(({ input, data }) => {
					const metric = input.requestedMetric ?? "cost";
					return [metric, data.metrics[metric]];
				}),
		),
	},
};
const previews: MetricPreviews = Object.fromEntries(
	answers.map(({ input, data }) => [input.requestedMetric ?? "cost", data]),
);
const metrics = listDashboardTabs(dashboard.availableMetrics);
const costData = dashboard.metrics.cost;

function DashboardChart({ metric }: { metric: DashboardMetric }) {
	return (
		<div className="cost-page w-full">
			<div className="cost-page-content">
				<CostChart
					data={dashboard}
					metric={metric}
					metrics={metrics}
					previews={previews}
					pending={false}
					runSignals={[]}
					signalTypes={[]}
					interval="daily"
					onMetricChange={NOOP}
					onRefresh={NOOP}
					refreshing={false}
					splitBy="none"
					onResetSplit={NOOP}
				/>
			</div>
		</div>
	);
}

function Breakdowns() {
	const [firstRepository] = costData?.breakdowns.repositories ?? [];
	return (
		<div className="cost-page w-full">
			<div className="cost-page-content">
				<div className="cost-breakdowns">
					{(["members", "repositories", "models"] as const).map((dimension) => (
						<CostBreakdown
							key={dimension}
							dimension={dimension}
							entries={costData?.breakdowns[dimension] ?? []}
							metric="cost"
							valueLabel={METRIC_LABELS.cost}
							unavailable={costData === null}
							selected={
								dimension === "repositories" && firstRepository
									? [firstRepository.id]
									: []
							}
							pending={false}
							split={false}
							onToggle={NOOP}
							onClear={NOOP}
							onSplit={NOOP}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

// Skills as the Skills page lists them, counted from the demo's sessions.
const SKILL_DESCRIPTIONS: Record<string, string> = {
	"testing-conventions":
		"How Loomrail tests are structured. Use when adding or fixing tests.",
	design:
		"Design and build UI with a consistent visual system: layout, spacing, states and tokens.",
	"flaky-test-hunter": "Systematic approach to flaky tests.",
};
function demoSkills(): HistoricalSkillSummary[] {
	const counts = new Map<
		string,
		{ sessions: number; repos: Set<string>; users: Set<string> }
	>();
	for (const session of seed.sessions)
		for (const skill of session.skills ?? []) {
			const entry = counts.get(skill) ?? {
				sessions: 0,
				repos: new Set<string>(),
				users: new Set<string>(),
			};
			entry.sessions += 1;
			entry.repos.add(session.repository ?? "");
			entry.users.add(session.user_id);
			counts.set(skill, entry);
		}
	return [...counts]
		.sort(([, a], [, b]) => b.sessions - a.sessions)
		.slice(0, 4)
		.map(([name, entry], index) => ({
			name,
			sessionCount: entry.sessions,
			claudeSessionCount: 0,
			codexSessionCount: entry.sessions,
			// The last card has no description, as a skill whose text was
			// never recovered.
			contentPreview:
				index === 3
					? null
					: `---\nname: ${name}\ndescription: ${SKILL_DESCRIPTIONS[name] ?? "Reproduce, minimise, hypothesise, instrument, fix, regression-test."}\n---\n`,
			attribution: {
				userCount: entry.users.size,
				topUsers: [],
				repoCount: entry.repos.size,
				topRepos: [],
			},
		}));
}

// MCP servers as the MCP page derives them from the tools agents called.
const MCP_TOOLS: RepositoryMcpTool[] = [
	{
		server: "playwright",
		tool: "mcp__playwright__browser_snapshot",
		calls: 115,
		sessions: 42,
	},
	{
		server: "playwright",
		tool: "mcp__playwright__browser_resize",
		calls: 57,
		sessions: 42,
	},
	{
		server: "playwright",
		tool: "mcp__playwright__browser_navigate",
		calls: 55,
		sessions: 42,
	},
	{
		server: "playwright",
		tool: "mcp__playwright__browser_click",
		calls: 14,
		sessions: 42,
	},
	{
		server: "github",
		tool: "mcp__github__get_pull_request",
		calls: 9,
		sessions: 12,
	},
	{
		server: "github",
		tool: "mcp__github__list_pull_requests",
		calls: 3,
		sessions: 12,
	},
	{
		server: "context7",
		tool: "mcp__context7__get-library-docs",
		calls: 7,
		sessions: 4,
	},
	{
		server: "context7",
		tool: "mcp__context7__resolve-library-id",
		calls: 7,
		sessions: 4,
	},
];
const servers = mcpServers(calledOnly(MCP_TOOLS, []), MCP_TOOLS);

export function CardsGroup() {
	return (
		<Group title="Cards and metrics">
			<Specimen
				name="CostChart: stat cards and chart card"
				source="features/costs/cost-chart.tsx"
				where="Dashboard (and a repo's Summary rail): the stat cards with their sparklines, the picked one ringed in its metric's colour; under them the chart card with its title and legend."
			>
				<State label="Cost picked, at rest" className="w-full">
					<DashboardChart metric="cost" />
				</State>
				<State label="Sessions picked" className="w-full">
					<DashboardChart metric="sessions" />
				</State>
			</Specimen>
			<Specimen
				name="CostBreakdown"
				source="features/costs/cost-breakdown.tsx"
				where="Dashboard, under the chart: Members, Repositories and Models with their share bars. A picked row filters the dashboard (Repositories, here)."
			>
				<Breakdowns />
			</Specimen>
			<Specimen
				name="SkillCardsGrid (OverviewCard, StripPill)"
				source="features/skills/components/skill-cards.tsx"
				where="Skills page: one card per skill, uses / repos / members pills on the tinted strip, the description below (or a note when none was recovered)."
			>
				<div className="w-full">
					<SkillCardsGrid skills={demoSkills()} onSelect={NOOP} />
				</div>
			</Specimen>
			<Specimen
				name="McpCardsGrid (OverviewCard)"
				source="features/mcp/mcp-page-view.tsx"
				where="MCP page: one card per server, calls / tools / sessions pills, its most-called tools below."
			>
				<div className="w-full">
					<McpCardsGrid servers={servers} onSelect={NOOP} />
				</div>
			</Specimen>
		</Group>
	);
}
