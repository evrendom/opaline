/**
 * Which inputs of a request name what its answer is about.
 *
 * The demo answers a request from a recording of the same path. Without an
 * exact one it may answer from another recording of that path, but only when
 * every identity input equals the request's (`createFixtureMatcher`): a
 * click never shows another session's, setup file's, skill's, MCP run's or
 * pull request's data. Otherwise the demo answers "This part of the app
 * isn't in the demo".
 *
 * Identity: the item (session, setup file, skill, MCP server or tool, pull
 * request or CI run, file, run, repository, analysis, pattern), the part of
 * it (revision, turn, cursor, offset), and, for views whose numbers are totals
 * over a range (dashboard, KPIs, sessions list and its filter catalog,
 * Compass runs and patterns, plan usage, upload failures), that range and
 * every filter, metric, split and sort.
 *
 * Presentation: page sizes, the chart interval (the dashboard draws weekly
 * and monthly from daily answers), `sessionMetrics` (the other stat cards
 * read "—"), transport flags (`bodyChunks`, `includeBodies`, `summaryOnly`),
 * `refresh` and `timeZone`; and the range of a view about one repository or
 * one item in it (its setup files, MCP tools, files, session boxes, runs and
 * calls), which the app itself keeps showing while the range changes
 * (`keepWhileRangeChanges`), and the range a Compass run is ranked against.
 *
 * An input a path does not list as presentation counts as identity, so an
 * input added to the contract later cannot bring stand-ins back;
 * demo-input-rules.bun-test.ts holds every RPC path here to its contract
 * (`@rudel/api-routes`).
 */
export interface DemoInputRules {
	/** Inputs that name what the answer is about: they must equal the recording's. */
	readonly identity: readonly string[];
	/** Inputs that only change how much is shown, or how: they may differ. */
	readonly presentation?: readonly string[];
	/** The contract's value for an input left out: leaving it out and sending it are the same request. */
	readonly defaults?: Readonly<Record<string, unknown>>;
}

const NONE: DemoInputRules = { identity: [] };

const SESSION: DemoInputRules = { identity: ["sessionId"] };

/** One repository's view: the range only narrows it. */
const REPOSITORY_RANGED: DemoInputRules = {
	identity: ["repoKey"],
	presentation: ["range"],
};

const DASHBOARD_FILTERS = [
	"members",
	"repositories",
	"models",
	"signalTypes",
	"phrases",
	"runSignals",
	"durations",
	"skillsUsed",
	"pullRequestCi",
	"githubAuthors",
	"ciConclusions",
	"ciEvents",
	"ciWorkflows",
	"ciAttempts",
] as const;

/** Paths as recorded: `/api/demo/rpc/…` is `/rpc/…`, `/api/demo/auth/…` is `/api/auth/…`. */
export const DEMO_INPUT_RULES: Readonly<Record<string, DemoInputRules>> = {
	// Reports.
	"/rpc/analysis/history/search": {
		identity: ["text", "includeEval"],
		presentation: ["limit"],
		defaults: { includeEval: false },
	},
	"/rpc/analysis/history/report": { identity: ["analysis"] },

	// Compass.
	"/rpc/analytics/moments/access": NONE,
	"/rpc/analytics/moments/settings": NONE,
	"/rpc/analytics/moments/list": {
		identity: ["startDate", "endDate", "kinds", "mine", "offset"],
		presentation: ["limit"],
		defaults: { kinds: [], mine: false, offset: 0 },
	},
	// The range only ranks the run's cost and duration.
	"/rpc/analytics/moments/run": {
		identity: ["userId", "sessionId", "agentId", "turn"],
		presentation: ["startDate", "endDate"],
	},
	"/rpc/analytics/moments/observe": {
		identity: ["userId", "sessionId", "agentId", "turn"],
		presentation: ["startDate", "endDate"],
	},
	"/rpc/analytics/moments/patterns": { identity: ["startDate", "endDate"] },
	"/rpc/analytics/moments/feedback": { identity: ["observationId", "useful"] },
	"/rpc/analytics/moments/recordFix": {
		identity: ["patternId", "note", "startDate", "endDate"],
	},
	"/rpc/analytics/moments/updateSettings": { identity: ["flags"] },

	// Dashboard.
	"/rpc/analytics/overview/costs": {
		identity: [
			"startDate",
			"endDate",
			"requestedMetric",
			"splitBy",
			...DASHBOARD_FILTERS,
		],
		presentation: ["durationInterval", "sessionMetrics"],
		defaults: {
			splitBy: "none",
			...Object.fromEntries(DASHBOARD_FILTERS.map((filter) => [filter, []])),
		},
	},
	"/rpc/analytics/overview/kpis": { identity: ["startDate", "endDate"] },
	"/rpc/analytics/overview/usersDailyTrend": {
		identity: ["startDate", "endDate"],
	},
	"/rpc/analytics/developers/list": {
		identity: ["days"],
		defaults: { days: 7 },
	},
	"/rpc/analytics/developers/teamCards": {
		identity: ["days"],
		defaults: { days: 7 },
	},

	// Sessions list.
	"/rpc/analytics/sessions/list": {
		identity: [
			"days",
			"startDate",
			"endDate",
			"repoKey",
			"skillName",
			"filters",
			"userId",
			"projectPath",
			"repository",
			"source",
			"offset",
			"sortBy",
			"sortOrder",
		],
		presentation: ["limit"],
		defaults: {
			days: 7,
			offset: 0,
			sortBy: "session_date",
			sortOrder: "desc",
		},
	},
	"/rpc/analytics/sessions/filterCatalog": {
		identity: ["days", "startDate", "endDate"],
		defaults: { days: 7 },
	},
	"/rpc/analytics/sessions/summaryComparison": {
		identity: ["days"],
		defaults: { days: 7 },
	},
	"/rpc/analytics/sessions/dimensionAnalysis": {
		identity: [
			"days",
			"dimension",
			"metric",
			"splitBy",
			"userId",
			"projectPath",
		],
		presentation: ["limit"],
		defaults: { days: 7 },
	},
	"/rpc/analytics/sessions/uploadFailures": {
		identity: ["sessionId", "startDate", "endDate", "offset"],
		presentation: ["limit"],
		defaults: { offset: 0 },
	},
	"/rpc/analytics/sessions/costMaximum": NONE,
	"/rpc/analytics/sessions/lastUpload": NONE,
	"/rpc/analytics/sessions/liveList": NONE,
	// Answered by demo-live.ts; listed for completeness.
	"/rpc/analytics/sessions/liveTail": {
		identity: ["sessionId", "source", "cursor"],
		presentation: ["summaryOnly"],
	},
	// Merged across recordings by session first (`createFixtureFetch`).
	"/rpc/analytics/sessions/mcpServers": { identity: ["sessionIds"] },
	"/rpc/analytics/sessions/runQuestionTags": { identity: ["sessionIds"] },

	// One session.
	"/rpc/analytics/sessions/detailInitial": {
		identity: ["sessionId"],
		presentation: ["bodyChunks"],
	},
	"/rpc/analytics/sessions/detailOverview": {
		identity: ["sessionId", "turnCursor"],
		presentation: ["turnLimit"],
	},
	"/rpc/analytics/sessions/detailRelationships": SESSION,
	"/rpc/analytics/sessions/detailSpine": {
		identity: ["sessionId", "revision"],
	},
	"/rpc/analytics/sessions/detailSubagent": {
		identity: ["sessionId", "revision", "subagentId"],
	},
	"/rpc/analytics/sessions/detailTurn": {
		identity: ["sessionId", "revision", "turnId"],
	},
	"/rpc/analytics/sessions/detailWindow": {
		identity: ["sessionId", "mode", "revision", "anchorTurnId", "cursor"],
		presentation: ["includeBodies", "bodyChunks"],
	},
	// The offset picks the chunk; the client checks each chunk's hash.
	"/rpc/analytics/sessions/detailBodyChunk": {
		identity: ["sessionId", "revision", "kind", "targetId", "offset"],
		defaults: { offset: 0 },
	},
	"/rpc/analytics/sessions/contextSnapshot": SESSION,
	"/rpc/analytics/sessions/summaryLinks": SESSION,
	"/rpc/analytics/sessions/setupRuns": SESSION,
	"/rpc/analytics/sessions/setupText": {
		identity: ["sessionId", "setupFile"],
	},
	"/rpc/analytics/sessions/runAnswers": SESSION,
	"/rpc/analytics/sessions/runCi": SESSION,

	// Repositories, and the workspace's setup, skills and MCP (no repoKey).
	"/rpc/analytics/repositories/list": NONE,
	"/rpc/analytics/repositories/navigation": NONE,
	"/rpc/analytics/repositories/pullRequests": { identity: ["repoKey"] },
	"/rpc/analytics/repositories/files": { identity: ["repoKey"] },
	"/rpc/analytics/repositories/file": {
		identity: ["repoKey", "path", "commitSha"],
	},
	"/rpc/analytics/repositories/fileActivity": REPOSITORY_RANGED,
	"/rpc/analytics/repositories/sessionBoxes": REPOSITORY_RANGED,
	"/rpc/analytics/repositories/setup": REPOSITORY_RANGED,
	"/rpc/analytics/repositories/mcpTools": REPOSITORY_RANGED,
	"/rpc/analytics/repositories/setupText": {
		identity: ["repoKey", "setupFile"],
		presentation: ["range"],
	},
	"/rpc/analytics/repositories/setupSessions": {
		identity: ["repoKey", "setupFile"],
		presentation: ["range"],
	},
	// `of`: the setup file, MCP server or tool, file paths, pull request or CI run.
	"/rpc/analytics/repositories/runs": {
		identity: ["repoKey", "of"],
		presentation: ["range"],
	},
	"/rpc/analytics/repositories/runCalls": {
		identity: ["repoKey", "of", "sessionId", "agentId", "startRecord"],
		presentation: ["range"],
	},
	"/rpc/analytics/skills/list": NONE,
	"/rpc/analytics/skills/detail": { identity: ["name"] },

	// Settings and shell.
	"/rpc/githubRepositoryEvidence/status": NONE,
	"/rpc/repositorySettings/list": NONE,
	"/rpc/sessionAccess": NONE,
	"/rpc/cli/setupStatus": NONE,
	"/rpc/cli/updateStatus": NONE,

	// Better Auth (query string for GET, JSON body for POST).
	"/api/auth/get-session": {
		identity: [],
		presentation: ["disableCookieCache", "disableRefresh"],
	},
	"/api/auth/organization/list": NONE,
	"/api/auth/organization/get-active-member": NONE,
	"/api/auth/organization/get-full-organization": {
		identity: ["organizationId", "organizationSlug"],
		presentation: ["membersLimit"],
	},
	"/api/auth/organization/check-slug": { identity: ["slug"] },
	"/api/auth/organization/set-active": {
		identity: ["organizationId", "organizationSlug"],
	},
	"/api/auth/organization/update": { identity: ["organizationId", "data"] },
	"/api/auth/organization/create": {
		identity: ["name", "slug", "logo", "keepCurrentActiveOrganization"],
	},

	// The Mac app's local server (query string).
	"/api/selfhost/info": NONE,
	"/api/selfhost/ingest/status": NONE,
	"/api/selfhost/plan-usage": {
		identity: ["from", "to", "repository"],
		presentation: ["buckets", "refresh"],
	},
	"/api/customer-activity": { identity: [], presentation: ["timeZone"] },
};

/** A path's rules; a path not listed has every input as identity. */
export function demoInputRules(path: string): DemoInputRules {
	return DEMO_INPUT_RULES[path] ?? NONE;
}
