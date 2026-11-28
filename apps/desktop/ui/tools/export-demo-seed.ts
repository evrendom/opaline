import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { SessionOverviewListRowSchema } from "@rudel/api-routes";
import { z } from "zod";
import type { DemoFixtureIndex } from "../src/features/demo/demo-fixtures";
import {
	DEMO_RANGE,
	DemoSeedSchema,
	demoPlanUsageSearch,
} from "../src/features/demo/demo-runtime";
import { getSessionOverviewCost } from "../src/features/sessions/components/sessions-overview-table-utils";
// @ts-expect-error a plain .mjs build helper
import { fetchDemoFixtures } from "./fetch-demo-fixtures.mjs";

await fetchDemoFixtures();
const fixtures = new URL("../demo-public/fixtures/", import.meta.url);
const index = JSON.parse(
	await readFile(new URL("index.json", fixtures), "utf8"),
) as DemoFixtureIndex;

async function answer(
	path: string,
	matches: (input: Record<string, unknown>, search: string) => boolean = () =>
		true,
) {
	const found = index.filter((fixture) => {
		if (fixture.path !== path) return false;
		const body = fixture.body ? JSON.parse(fixture.body) : {};
		return matches(body.json ?? {}, fixture.search);
	});
	if (found.length === 0) throw new Error(`No recorded answer for ${path}`);
	return Promise.all(
		found.map(async (fixture) => {
			const text = gunzipSync(
				await readFile(new URL(fixture.file, fixtures)),
			).toString("utf8");
			const parsed = JSON.parse(text);
			return {
				input: (fixture.body ? JSON.parse(fixture.body).json : {}) ?? {},
				data: path.startsWith("/rpc/") ? parsed.json : parsed,
			};
		}),
	);
}

const first = async (...args: Parameters<typeof answer>) => {
	const [found] = await answer(...args);
	if (!found) throw new Error(`No recorded answer for ${args[0]}`);
	return found.data;
};

const inRange = (input: Record<string, unknown>) =>
	input.startDate === DEMO_RANGE.startDate &&
	input.endDate === DEMO_RANGE.endDate;
const unfiltered = (input: Record<string, unknown>) =>
	Object.values(input).every(
		(value) => !Array.isArray(value) || value.length === 0,
	);
// The list the Sessions page asks for on DEMO_RANGE: the first page of every
// session, newest first (not one repository's, skill's or a filtered list).
const SESSION_LIST_SCOPES = [
	"repoKey",
	"skillName",
	"filters",
	"userId",
	"projectPath",
	"repository",
	"source",
];
const sessionsPage = (input: Record<string, unknown>) =>
	inRange(input) &&
	(input.offset ?? 0) === 0 &&
	(input.sortBy ?? "session_date") === "session_date" &&
	(input.sortOrder ?? "desc") === "desc" &&
	SESSION_LIST_SCOPES.every((scope) => input[scope] === undefined);

const organization = z
	.object({
		id: z.string(),
		name: z.string(),
		slug: z.string(),
		members: z.array(
			z.object({ userId: z.string(), user: z.object({ name: z.string() }) }),
		),
	})
	.parse(await first("/api/auth/organization/get-full-organization"));
const session = z
	.object({ user: z.object({ id: z.string() }) })
	.parse(await first("/api/auth/get-session"));
// The desktop app asks for the whole range at once (up to 1000 rows) and a
// paged list for 50: take the longest page recorded.
const sessions = z
	.array(SessionOverviewListRowSchema)
	.parse(
		[...(await answer("/rpc/analytics/sessions/list", sessionsPage))].sort(
			(a, b) => Number(b.input.limit ?? 0) - Number(a.input.limit ?? 0),
		)[0]?.data,
	);
const costs = (
	await answer(
		"/rpc/analytics/overview/costs",
		// The opening screen is daily; other intervals are recorded too.
		(input) =>
			inRange(input) &&
			unfiltered(input) &&
			(input.durationInterval ?? "daily") === "daily",
	)
).filter(
	(entry, position, all) =>
		all.findIndex(
			(other) => JSON.stringify(other.input) === JSON.stringify(entry.input),
		) === position,
);
const dashboard = costs.find(
	({ input }) => input.requestedMetric === "cost" && input.splitBy === "none",
);
if (!dashboard) throw new Error("No recorded cost dashboard");
const offered = new Set<string>(dashboard.data.availableMetrics);
const CARD_ORDER = [
	"sessions",
	"agentRuns",
	"signals",
	"mergedPullRequests",
	"ciRuns",
];
const GITHUB_CARDS = new Set(["mergedPullRequests", "ciRuns"]);
const cardRank = (input: Record<string, unknown>) =>
	CARD_ORDER.indexOf(String(input.requestedMetric)) +
	(input.splitBy === "none" ? 0 : CARD_ORDER.length);
const previews = costs
	.filter(
		(entry) =>
			entry !== dashboard &&
			CARD_ORDER.includes(String(entry.input.requestedMetric)) &&
			offered.has(String(entry.input.requestedMetric)),
	)
	.sort((a, b) => cardRank(a.input) - cardRank(b.input))
	.filter((entry, position, all) => {
		const github = GITHUB_CARDS.has(String(entry.input.requestedMetric));
		const preview = github === (entry.input.sessionMetrics === false);
		const twin = all.find(
			(other, at) =>
				at !== position &&
				other.input.requestedMetric === entry.input.requestedMetric &&
				other.input.splitBy === entry.input.splitBy,
		);
		return preview || !twin;
	});

const seed = DemoSeedSchema.parse({
	organization: {
		id: organization.id,
		name: organization.name,
		slug: organization.slug,
		logo: "",
	},
	members: organization.members.map((member) => ({
		userId: member.userId,
		name: member.user.name,
		image: "",
	})),
	viewerUserId: session.user.id,
	sessions: sessions.slice(0, 30),
	totalSessionCount: sessions.length,
	repositories: await first("/rpc/analytics/repositories/list"),
	navigation: await first("/rpc/analytics/repositories/navigation"),
	lastUpload: await first("/rpc/analytics/sessions/lastUpload"),
	dashboard,
	previews,
	maxima: {
		input: Math.max(...sessions.map((row) => row.input_tokens)),
		output: Math.max(...sessions.map((row) => row.output_tokens)),
		tokens: Math.max(
			...sessions.map((row) => row.input_tokens + row.output_tokens),
		),
		cost: Math.max(...sessions.map((row) => getSessionOverviewCost(row) ?? 0)),
	},
	selfHost: await first("/api/selfhost/info"),
	planUsage: await first(
		"/api/selfhost/plan-usage",
		(_input, search) => search === `?${demoPlanUsageSearch()}`,
	),
});
await writeFile(
	new URL("../src/features/demo/seed.json", import.meta.url),
	JSON.stringify(seed),
);
console.log(
	`Saved the first screen of ${seed.totalSessionCount} recorded sessions; no transcripts or credentials.`,
);
