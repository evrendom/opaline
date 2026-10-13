import type {
	DigestNumbers,
	DigestSection,
	DigestTeamSection,
	UsageDigestEmailData,
} from "@rudel/api-routes/usage-digest-email";

// Sample digests for the email lab: invented numbers shaped like a busy
// member of a small team, so every block of the email has something to show.

const numbers = (overrides: Partial<DigestNumbers>): DigestNumbers => ({
	sessions: 44,
	prompts: 412,
	activeMinutes: 2449,
	costUsd: 831.36,
	runs: 512,
	toolCalls: 9_840,
	failedCalls: 413,
	interrupts: 23,
	compactions: 9,
	apiErrors: 4,
	cacheReadTokens: 412_000_000,
	longestRunMinutes: 74,
	inputTokens: 468_000_000,
	turnErrors: 3,
	timeouts: 2,
	refusals: 1,
	...overrides,
});

const weeklyYou: DigestSection = {
	current: numbers({}),
	previous: numbers({
		sessions: 47,
		prompts: 368,
		activeMinutes: 1836,
		costUsd: 710.28,
		toolCalls: 8_120,
		failedCalls: 471,
		interrupts: 31,
		compactions: 6,
		apiErrors: 11,
		longestRunMinutes: 52,
	}),
	days: [412, 538, 611, 380, 402, 106, 0],
	repositories: [
		{ label: "acme/web", value: 1210, share: 0.49 },
		{ label: "acme/api", value: 820, share: 0.33 },
		{ label: "acme/infra", value: 301, share: 0.12 },
	],
	agents: [
		{ label: "Claude Code", value: 371, share: 0.72 },
		{ label: "Codex", value: 141, share: 0.28 },
	],
	models: [
		{
			label: "Claude Opus 5.5",
			value: 276,
			share: 0.54,
			provider: "anthropic",
		},
		{ label: "GPT-6.1", value: 141, share: 0.28, provider: "openai" },
		{
			label: "Claude Sonnet 5.5",
			value: 95,
			share: 0.18,
			provider: "anthropic",
		},
	],
	toolbox: [
		{ name: "/review", uses: 14, kind: "command" },
		{ name: "simplify", uses: 9, kind: "skill" },
		{ name: "/clear", uses: 8, kind: "command" },
		{ name: "tdd", uses: 5, kind: "skill" },
		{ name: "frontend-design", uses: 4, kind: "skill" },
		{ name: "/compact", uses: 3, kind: "command" },
	],
	subagents: {
		current: {
			launches: 38,
			minutes: 412,
			runs: 61,
			costUsd: 96.4,
			toolCalls: 2_310,
			failedCalls: 74,
		},
		previous: {
			launches: 29,
			minutes: 351,
			runs: 47,
			costUsd: 81.2,
			toolCalls: 1_980,
			failedCalls: 91,
		},
		types: [
			{ name: "Explore", uses: 21 },
			{ name: "general-purpose", uses: 12 },
			{ name: "Plan", uses: 5 },
		],
	},
	frustration: {
		moments: 9,
		previousMoments: 14,
		swears: 2,
		apologies: 11,
		phrases: [
			{ text: "didn't work", count: 4 },
			{ text: "still not working", count: 2 },
			{ text: "exactly the same", count: 2 },
			{ text: "not good", count: 1 },
		],
		sessions: [
			{
				title: "Fix the flaky checkout test in CI",
				day: "2026-10-07",
				moments: 4,
			},
			{
				title: "Migrate billing webhooks to the queue",
				day: "2026-10-08",
				moments: 3,
			},
			{ title: "acme/infra", day: "2026-10-05", moments: 2 },
		],
	},
};

const weeklyTeam: DigestTeamSection = {
	current: numbers({
		sessions: 194,
		prompts: 1597,
		activeMinutes: 8847,
		costUsd: 2715.61,
	}),
	previous: numbers({
		sessions: 170,
		prompts: 2086,
		activeMinutes: 9368,
		costUsd: 3065.31,
	}),
	activeMembers: 6,
	previousActiveMembers: 5,
	days: [1490, 1760, 1980, 1540, 1302, 460, 315],
	repositories: [
		{ label: "acme/web", value: 3810, share: 0.43 },
		{ label: "acme/api", value: 2950, share: 0.33 },
		{ label: "acme/mobile", value: 1120, share: 0.13 },
	],
	agents: [],
	models: [],
	toolbox: [],
	subagents: {
		current: {
			launches: 0,
			minutes: 0,
			runs: 0,
			costUsd: 0,
			toolCalls: 0,
			failedCalls: 0,
		},
		previous: null,
		types: [],
	},
	frustration: null,
};

const dailyYou: DigestSection = {
	current: numbers({
		sessions: 15,
		prompts: 83,
		activeMinutes: 444,
		costUsd: 153.76,
		runs: 96,
		toolCalls: 1_904,
		failedCalls: 61,
		interrupts: 4,
		compactions: 2,
		apiErrors: 0,
		cacheReadTokens: 88_000_000,
		longestRunMinutes: 41,
		inputTokens: 97_000_000,
	}),
	previous: numbers({
		sessions: 10,
		prompts: 67,
		activeMinutes: 361,
		costUsd: 85.07,
		runs: 71,
		toolCalls: 1_410,
		failedCalls: 70,
		interrupts: 6,
		compactions: 1,
		apiErrors: 2,
		longestRunMinutes: 33,
	}),
	days: null,
	repositories: [
		{ label: "acme/web", value: 301, share: 0.68 },
		{ label: "acme/api", value: 143, share: 0.32 },
	],
	agents: [{ label: "Claude Code", value: 96, share: 1 }],
	models: [
		{ label: "Claude Opus 5.5", value: 70, share: 0.73, provider: "anthropic" },
		{
			label: "Claude Sonnet 5.5",
			value: 26,
			share: 0.27,
			provider: "anthropic",
		},
	],
	toolbox: [
		{ name: "/review", uses: 3, kind: "command" },
		{ name: "simplify", uses: 2, kind: "skill" },
	],
	subagents: {
		current: {
			launches: 6,
			minutes: 58,
			runs: 9,
			costUsd: 11.3,
			toolCalls: 310,
			failedCalls: 9,
		},
		previous: null,
		types: [{ name: "Explore", uses: 6 }],
	},
	frustration: {
		moments: 0,
		previousMoments: 3,
		swears: 0,
		apologies: 0,
		phrases: [],
		sessions: [],
	},
};

const links = (kind: "daily" | "weekly") => ({
	workspaceName: "Acme",
	workspaceUrl: "https://opaline.so/acme/sessions",
	settingsUrl: "https://opaline.so/acme/settings/account#email-digests",
	unsubscribeUrl: `https://opaline.so/api/usage-digest/unsubscribe?token=${kind}`,
	inviteUrl: null,
});

export type LabVariant =
	| "weekly"
	| "weekly-no-sessions"
	| "weekly-own-sessions-only"
	| "weekly-alone"
	| "daily"
	| "quiet-week";

export const LAB_VARIANTS: { id: LabVariant; label: string }[] = [
	{ id: "weekly", label: "Weekly" },
	{ id: "weekly-no-sessions", label: "Weekly, member had no sessions" },
	{ id: "weekly-own-sessions-only", label: "Weekly, no team section" },
	{ id: "weekly-alone", label: "Weekly, alone in the workspace" },
	{ id: "daily", label: "Daily" },
	{ id: "quiet-week", label: "Quiet week" },
];

export function labDigest(
	variant: Exclude<LabVariant, "quiet-week">,
	assetOrigin: string,
): UsageDigestEmailData {
	const weekly = {
		kind: "weekly" as const,
		...links("weekly"),
		periodLabel: "Oct 5 to Oct 11",
		comparisonLabel: "the week before",
		assetOrigin,
	};
	if (variant === "weekly")
		return { ...weekly, you: weeklyYou, team: weeklyTeam };
	if (variant === "weekly-no-sessions")
		return { ...weekly, you: null, team: weeklyTeam };
	if (variant === "weekly-own-sessions-only")
		return { ...weekly, you: weeklyYou, team: null };
	if (variant === "weekly-alone")
		return {
			...weekly,
			you: weeklyYou,
			team: null,
			inviteUrl: "https://opaline.so/acme/settings/members",
		};
	return {
		kind: "daily",
		...links("daily"),
		periodLabel: "Monday, Oct 12",
		comparisonLabel: "the Monday before",
		assetOrigin,
		you: dailyYou,
		team: null,
	};
}
