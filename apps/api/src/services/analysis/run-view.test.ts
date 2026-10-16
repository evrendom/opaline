import { expect, test } from "bun:test";
import { CURRENT_PHASE_RULE } from "./phases.js";
import {
	DEFAULT_RUN_VIEW_SECTIONS,
	type RunView,
	type RunViewRequest,
	renderRunView,
} from "./run-view.js";

const RUN_ID = "u1/claude_code/s1//40";
const MINUTE = 60_000;

/** A request at minute `at` lasting `minutes`, with its calls as [tool, group, class, failed]. */
function request(
	record: number,
	at: number,
	minutes: number,
	tokens: number | null,
	calls: [string, string, string?, boolean?][],
	text: string | null = null,
): RunViewRequest {
	return {
		record,
		startedMs: at * MINUTE,
		endedMs: (at + minutes) * MINUTE,
		calls: calls.map(
			([tool, group, commandClass = "", failed = false], index) => ({
				record: record + 1 + index,
				tool,
				group,
				commandClass,
				failed,
			}),
		),
		text: text === null ? null : { record: record + 9, block: 0, head: text },
		tokens,
		costUsd: tokens === null ? null : tokens / 100_000,
	};
}

const view: RunView = {
	id: RUN_ID,
	agent: "claude_code",
	prompt: "fix the failing login test",
	task: null,
	minutes: 42,
	tokens: 410_000,
	costUsd: 3.1,
	requestsIndexed: true,
	previous: {
		id: "u1/claude_code/s1//10",
		prompt: "add rate limiting to login",
		end: "Done, added a limiter in auth.ts",
	},
	next: { id: "u1/claude_code/s1//90", prompt: "it still fails, damn it" },
	requests: [
		request(41, 0, 4, 60_000, [
			["Grep", "search"],
			["Read", "read"],
		]),
		request(50, 4, 2, 28_000, [["Read", "read"]]),
		request(60, 6, 1, 12_000, [["Edit", "edit"]]),
		request(70, 7, 20, 150_000, [["Bash", "shell", "test", true]]),
		request(80, 27, 11, 140_000, [["Bash", "shell", "test"]]),
		request(85, 38, 4, 20_000, [], "Fixed! The test now passes."),
	],
	setup: [
		{
			id: "s1",
			kind: "system_prompt",
			setupFile: "harness:claude_code:system_prompt",
			versionName: "3f2a9c1b04de",
			chars: 91_204,
			carried: true,
			compactedSince: false,
		},
		{
			id: "s2",
			kind: "instructions",
			setupFile: "repository:github.com/acme/shop:CLAUDE.md",
			versionName: "e5d10a2b7c44 uncommitted by u1",
			chars: 812,
			carried: true,
			compactedSince: true,
		},
		{
			id: "s3",
			kind: "skill_body",
			setupFile:
				"repository:github.com/acme/shop:.claude/skills/fix-tests/SKILL.md",
			versionName: "77ab01c9d2e0",
			chars: 2_310,
			carried: false,
			compactedSince: false,
		},
	],
};

const render = (
	options: Partial<Parameters<typeof renderRunView>[1]> = {},
	subject: RunView = view,
) =>
	renderRunView(subject, {
		sections: DEFAULT_RUN_VIEW_SECTIONS,
		expand: [],
		maxChars: 12_000,
		rule: CURRENT_PHASE_RULE,
		details: new Map(),
		...options,
	});

test("the default view shows the header, PREV, END, NEXT, the setup the run had and the phases with their requests, time, tokens and cost, each line under an id", () => {
	const { text, truncated } = render();
	expect(truncated).toBe(false);
	expect(text.split("\n")).toEqual([
		`run ${RUN_ID} · claude_code · "fix the failing login test" · 42 min · 410k tokens · $3.10 · phases by rule 1`,
		`PREV u1/claude_code/s1//10 · "add rate limiting to login" → END "Done, added a limiter in auth.ts"`,
		'END  r94 · "Fixed! The test now passes."',
		'NEXT u1/claude_code/s1//90 · user: "it still fails, damn it" · reaction: unhappy (strongly worded)',
		"SETUP s1  system_prompt harness:claude_code:system_prompt · version 3f2a9c1b04de · 91204 chars · received earlier",
		"      s2  instructions repository:github.com/acme/shop:CLAUDE.md · version e5d10a2b7c44 uncommitted by u1 · 812 chars · received earlier · compacted since",
		"      s3  skill_body repository:github.com/acme/shop:.claude/skills/fix-tests/SKILL.md · version 77ab01c9d2e0 · 2310 chars",
		"id   what happened                                requests  time    tokens  cost",
		"p1   exploring: Read×2, Grep                             2  6 min      88k  $0.88",
		"p2   editing: Edit                                       1  1 min      12k  $0.12",
		"p3   running checks: Bash test×2 (1 failed)              2  31 min    290k  $2.90",
		"p4   talking to the user                                 1  4 min      20k  $0.20",
	]);
});

test("expanding a phase lists its requests with their time, tokens and cost", () => {
	const { text } = render({ sections: ["header"], expand: ["p3"] });
	expect(text.split("\n").slice(1)).toEqual([
		"▸ p3 running checks: 2 requests",
		"  q70   Bash test · 20 min · 150k tokens · $1.50 · 1 failed",
		"  q80   Bash test · 11 min · 140k tokens · $1.40",
	]);
});

test("expanding two phases at once stays within the budget, gives each a share and marks what was cut", () => {
	const full = render({ expand: ["p1", "p3"] }).text;
	const maxChars = full.length - 60;
	const { text, truncated } = render({ expand: ["p1", "p3"], maxChars });
	expect(truncated).toBe(true);
	expect(text.length).toBeLessThanOrEqual(maxChars);
	expect(text).toContain("▸ p1 exploring: 2 requests");
	expect(text).toContain("▸ p3 running checks: 2 requests");
	expect(text).toMatch(/\n {2}\[cut: [01] of 2 requests of p3 shown\]$/u);
});

test("expanding a request lists its calls with their duration and outcome, and the record of its text", () => {
	const details = new Map([
		[
			"q80",
			{
				kind: "calls" as const,
				calls: [
					{
						id: "c81",
						tool: "Bash",
						commandClass: "test",
						input: "bun test src/auth.test.ts",
						durationMs: 4_200,
						failed: false,
						startedSubagent: false,
						subagentRunId: null,
					},
				],
			},
		],
		["q85", { kind: "calls" as const, calls: [] }],
	]);
	const { text } = render({ sections: [], expand: ["q80", "q85"], details });
	expect(text.split("\n")).toEqual([
		"▸ q80 1 call · 11 min · 140k tokens · $1.40",
		'  c81   Bash test · "bun test src/auth.test.ts" · 4.2 s',
		"▸ q85 0 calls · 4 min · 20k tokens · $0.20",
		'  r94   text: "Fixed! The test now passes."',
	]);
});

test("expanding a record returns its exact text, and a cut text says how much of it was shown", () => {
	const exact = 'Fixed! The "login" test\n\tnow passes ✓\n'.repeat(20);
	const details = new Map([
		[
			"r94",
			{
				kind: "text" as const,
				parts: [
					{
						label: "r94 assistant text",
						text: exact,
						totalChars: [...exact].length,
					},
				],
			},
		],
	]);
	const whole = render({ sections: [], expand: ["r94"], details });
	expect(whole.truncated).toBe(false);
	expect(whole.text).toBe(
		`▸ r94 assistant text, ${[...exact].length} characters\n${exact}`,
	);

	const cut = render({ sections: [], expand: ["r94"], details, maxChars: 400 });
	const [heading, ...rest] = cut.text.split("\n");
	const marker = rest.at(-1) ?? "";
	const shown = rest.slice(0, -1).join("\n");
	expect(cut.truncated).toBe(true);
	expect(cut.text.length).toBeLessThanOrEqual(400);
	expect(heading).toBe(`▸ r94 assistant text, ${[...exact].length} characters`);
	expect(exact.startsWith(shown)).toBe(true);
	expect(marker).toBe(
		`  [cut: ${[...shown].length} of ${[...exact].length} characters of r94 shown]`,
	);
});

test("a call that started a subagent expands into the subagent's run, in the same view, without ids that would open the parent's", () => {
	const subagent: RunView = {
		...view,
		id: "u1/claude_code/s1/a7/3",
		prompt: null,
		task: "find where login is tested",
		minutes: 3,
		tokens: 40_000,
		costUsd: 0.4,
		previous: null,
		next: null,
		requests: [
			request(4, 0, 3, 40_000, [["Grep", "search"]], "In auth.test.ts"),
		],
		setup: view.setup?.slice(1, 2) ?? [],
	};
	const details = new Map([["c71", { kind: "run" as const, view: subagent }]]);
	const { text } = render({ sections: [], expand: ["c71"], details });
	expect(text.split("\n")).toEqual([
		"▸ c71 started subagent run u1/claude_code/s1/a7/3; open it with run to expand its phases, requests and records",
		'  run u1/claude_code/s1/a7/3 · claude_code · task "find where login is tested" · 3 min · 40k tokens · $0.40 · phases by rule 1',
		"  PREV none: the first run of its stream",
		'  END  "In auth.test.ts"',
		"  NEXT none: the last run of its stream",
		"  SETUP instructions repository:github.com/acme/shop:CLAUDE.md · version e5d10a2b7c44 uncommitted by u1 · 812 chars · received earlier · compacted since",
		"       what happened                                requests  time    tokens  cost",
		"       exploring: Grep                                     1  3 min      40k  $0.40",
	]);
});

test("a run whose requests are not indexed yet says so instead of showing no phases", () => {
	const lines = render(
		{ sections: ["end", "phases"] },
		{ ...view, requestsIndexed: false, requests: [] },
	).text.split("\n");
	expect(lines).toEqual([
		"END  unknown: this run's requests are not indexed yet",
		"phases unknown: this run's requests are not indexed yet (run index before version 5)",
	]);
});

test("a run whose received setup was not read says unknown, never none", () => {
	expect(render({ sections: ["setup"] }, { ...view, setup: null }).text).toBe(
		"SETUP unknown: this run's received setup was not read (its session was indexed before received setup was recorded)",
	);
	expect(render({ sections: ["setup"] }, { ...view, setup: [] }).text).toBe(
		"SETUP none: its transcript records no setup text for this run",
	);
});

test("expanding a setup id opens the exact text the run received, at the version it used", () => {
	const claudeMd = "# Shop\nRun `bun test` before every commit.\n";
	const details = new Map([
		[
			"s2",
			{
				kind: "text" as const,
				parts: [
					{
						label:
							"s2 instructions repository:github.com/acme/shop:CLAUDE.md version e5d10a2b7c44 uncommitted by u1",
						text: claudeMd,
						totalChars: claudeMd.length,
					},
				],
			},
		],
	]);
	expect(render({ sections: [], expand: ["s2"], details }).text).toBe(
		`▸ s2 instructions repository:github.com/acme/shop:CLAUDE.md version e5d10a2b7c44 uncommitted by u1, ${claudeMd.length} characters\n${claudeMd}`,
	);
});

test("records whose text cannot be read at all still fit their cut lines in the budget", () => {
	const ids = Array.from({ length: 20 }, (_, index) => `r${100 + index}`);
	const details = new Map(
		ids.map((id) => [
			id,
			{
				kind: "text" as const,
				parts: [{ label: `${id} tool_result`, text: "", totalChars: 900_000 }],
			},
		]),
	);
	const { text, truncated } = render({
		sections: ["header"],
		expand: ids,
		details,
		maxChars: 1_000,
	});
	expect(truncated).toBe(true);
	expect(text.length).toBeLessThanOrEqual(1_000);
	expect(text).toContain(
		"▸ r100 tool_result, 900000 characters\n  [cut: 0 of 900000 characters of r100 shown]",
	);
});

test("a text past a record's first block (after reasoning) is named by its block, in END and in its request", () => {
	const last = request(85, 38, 4, 20_000, [], "Fixed! The test now passes.");
	const subject: RunView = {
		...view,
		requests: [
			...view.requests.slice(0, -1),
			{ ...last, text: { record: 94, block: 2, head: "Fixed!" } },
		],
	};
	const { text } = render(
		{
			sections: ["end"],
			expand: ["q85"],
			details: new Map([["q85", { kind: "calls" as const, calls: [] }]]),
		},
		subject,
	);
	expect(text.split("\n")).toEqual([
		'END  r94.2 · "Fixed!"',
		"▸ q85 0 calls · 4 min · 20k tokens · $0.20",
		'  r94.2 text: "Fixed!"',
	]);
});

test("a run a queued prompt cut off says so: its last text is where the work was, and the next run continues it", () => {
	const cut = render(
		{},
		{
			...view,
			next: view.next && { ...view.next, queuedBoundary: true },
		},
	).text.split("\n");
	expect(cut[2]).toBe(
		'END  cut off mid-work: the person\'s queued prompt started the next run, which continues it; last text r94 · "Fixed! The test now passes."',
	);
	expect(cut[3]).toStartWith(
		"NEXT u1/claude_code/s1//90 · user (queued while this run worked): ",
	);
	const continued = render(
		{},
		{
			...view,
			previous: view.previous && { ...view.previous, queuedBoundary: true },
		},
	).text.split("\n");
	expect(continued[1]).toBe(
		`PREV u1/claude_code/s1//10 · "add rate limiting to login" → cut off mid-work by this run's queued prompt; its last text: "Done, added a limiter in auth.ts"`,
	);
});
