import type { SessionAnalytics } from "@rudel/api-routes";
import { pebbleMasks } from "@/features/costs/cost-dot-pebble";
import { SessionsOverviewFluidList } from "./sessions-overview-fluid-list";
import { SessionsOverviewRow } from "./sessions-overview-row";

const BASE: SessionAnalytics = {
	cost_uses_default_region: false,
	duration_min: 17,
	error_count: 0,
	estimated_cost: 4,
	git_branch: "main",
	git_remote: "github.com/you/web-app",
	input_tokens: 438317,
	linked_subagent_count: 0,
	linked_subagents: [],
	member_apologies: 0,
	member_apology_matches: [],
	member_positive: 0,
	member_positive_matches: [],
	member_swear_matches: [],
	member_swears: 0,
	model_apologies: 0,
	model_apology_matches: [],
	model_positive: 0,
	model_positive_matches: [],
	model_swear_matches: [],
	model_swears: 0,
	model_used: "claude-opus-4-5",
	native_child_sessions: [],
	native_subagents: [],
	output_tokens: 6558,
	project_path: "/workspace/web-app",
	repository: "you/web-app",
	repository_identity: {
		repoKey: "remote:github.com/you/web-app",
		repoLabel: "web-app",
		repoName: "web-app",
		source: "remote",
		worktree: null,
	},
	session_date: "2026-10-30T09:00:00Z",
	session_id: "sample",
	skills: [],
	slash_commands: [],
	source: "claude_code",
	subagent_count: 0,
	subagent_types: [],
	total_interactions: 51,
	total_tokens: 444875,
	user_id: "sample",
	worktree: null,
};

const PLAN_SHARES = [
	3, 0.4, 6, 1, 0.2, 9, 2, 4, 0.8, 1, 14, 3, 0.1, 2, 5, 1, 0.3, 2, 3, 4,
];
const MCP_SERVERS = [["github"], [], ["linear"], [], [], ["github", "sentry"]];
const MEMBER_WORDS = [["good"], [], [], ["thanks"], [], ["nice"], [], []];

const ROWS: [string, string, number, number, string[]][] = [
	["web-app", "feature/session-figures", 7, 2, []],
	["api-server", "fix/upload-retry", 1, 0, ["code-review"]],
	["web-app", "main", 12, 1, []],
	["mobile", "feature/offline-sync", 3, 0, ["testing"]],
	["docs", "docs/getting-started", 2, 3, []],
	["web-app", "perf/list-virtualizer", 11, 0, ["tdd", "code-review"]],
	["infra", "main", 4, 1, []],
	["api-server", "feature/billing", 9, 0, []],
	["design-system", "feature/tokens", 1, 0, ["design"]],
	["web-app", "fix/dark-mode", 2, 2, []],
	["data-pipeline", "main", 29, 0, ["database-query"]],
	["web-app", "feature/onboarding", 6, 1, []],
	["cli", "fix/auth-refresh", 1, 0, []],
	["api-server", "main", 5, 0, ["testing"]],
	["mobile", "fix/crash-on-launch", 8, 4, []],
	["web-app", "feature/search", 3, 0, []],
	["docs", "main", 1, 0, []],
	["infra", "feature/alerts", 2, 1, []],
	["web-app", "fix/flaky-tests", 4, 0, ["testing"]],
	["api-server", "feature/webhooks", 7, 0, []],
];

const SAMPLE_SESSIONS: SessionAnalytics[] = ROWS.map(
	([repo, branch, cost, errors, skills], index) => ({
		...BASE,
		error_count: errors,
		estimated_cost: cost,
		git_branch: branch,
		repository: `you/${repo}`,
		repository_identity: {
			repoKey: `remote:github.com/you/${repo}`,
			repoLabel: repo,
			repoName: repo,
			source: "remote",
			worktree: null,
		},
		member_positive: MEMBER_WORDS[index % MEMBER_WORDS.length]?.length ?? 0,
		member_positive_matches: MEMBER_WORDS[index % MEMBER_WORDS.length] ?? [],
		session_id: `sample-${index}`,
		skills,
	}),
);

const MARK_SIZE = 28;

export const SAMPLE_MARK_STYLE = pebbleMasks(MARK_SIZE);

export const sampleMarkBars =
	typeof CSSStyleSheet !== "undefined" &&
	"replaceSync" in CSSStyleSheet.prototype
		? new CSSStyleSheet()
		: null;
sampleMarkBars?.replaceSync(
	`[skullet-rect][style*="width: ${MARK_SIZE}px; height: ${MARK_SIZE}px; border-radius: 1.67772e+07px"] { corner-shape: round; border-radius: 0; mask: var(--pebble-fill, none) center / 100% 100% no-repeat; }`,
);

export function SessionsOverviewSample({
	showSkillsColumn = true,
	showPlanUsage = false,
}: {
	showSkillsColumn?: boolean;
	showPlanUsage?: boolean;
}) {
	return (
		<SessionsOverviewFluidList fillHeight height={undefined}>
			{({ registerItem, setActiveIndex }) =>
				SAMPLE_SESSIONS.map((session, index) => (
					<SessionsOverviewRow
						key={session.session_id}
						activeSessionId={null}
						avatarUrl={undefined}
						canOpenSession={undefined}
						getSessionHref={undefined}
						getSessionLinkState={undefined}
						index={index}
						maximumSessionCost={30}
						mcpServers={(MCP_SERVERS[index % MCP_SERVERS.length] ?? []).map(
							(server) => ({ server, at: 0 }),
						)}
						memberProfile={undefined}
						onSessionClick={undefined}
						planUsage={showPlanUsage ? PLAN_SHARES[index] : undefined}
						registerItem={registerItem}
						session={session}
						setHoverActiveIndex={setActiveIndex}
						showSkillsColumn={showSkillsColumn}
						userLabel="you"
					/>
				))
			}
		</SessionsOverviewFluidList>
	);
}
