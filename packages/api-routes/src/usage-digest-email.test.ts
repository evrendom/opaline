import { describe, expect, test } from "bun:test";
import {
	buildUsageDigestEmail,
	type DigestNumbers,
	type DigestSection,
	formatChange,
	formatCost,
	formatMinutes,
	type UsageDigestEmailData,
} from "./usage-digest-email.js";

const numbers: DigestNumbers = {
	sessions: 12,
	prompts: 80,
	activeMinutes: 200,
	costUsd: 23.1,
	runs: 40,
	toolCalls: 100,
	failedCalls: 5,
	interrupts: 2,
	compactions: 1,
	apiErrors: null,
	cacheReadTokens: 90,
	longestRunMinutes: 25,
	inputTokens: 100,
	turnErrors: 0,
	timeouts: 0,
	refusals: 0,
};
const noSubagents = {
	launches: 0,
	minutes: 0,
	runs: 0,
	costUsd: 0,
	toolCalls: 0,
	failedCalls: 0,
};
const section: DigestSection = {
	current: numbers,
	previous: { ...numbers, sessions: 8 },
	days: [10, 0, 0, 0, 0, 0, 0],
	repositories: [{ label: "acme/web", value: 200, share: 1 }],
	agents: [],
	models: [],
	toolbox: [],
	subagents: { current: noSubagents, previous: null, types: [] },
	frustration: null,
};
const data: UsageDigestEmailData = {
	kind: "weekly",
	workspaceName: "Acme <Labs>",
	periodLabel: "Oct 5 to Oct 11",
	comparisonLabel: "the week before",
	you: section,
	team: null,
	inviteUrl: null,
	workspaceUrl: "https://opaline.so/acme/sessions",
	settingsUrl: "https://opaline.so/acme/settings/account#email-digests",
	unsubscribeUrl: "https://opaline.so/api/usage-digest/unsubscribe?token=a.b",
	assetOrigin: "https://opaline.so",
};

describe("usage digest email", () => {
	test("formats numbers for reading", () => {
		expect(formatMinutes(45.4)).toBe("45m");
		expect(formatMinutes(200)).toBe("3h 20m");
		expect(formatCost(0.004)).toBe("<$0.01");
		expect(formatCost(1234.5)).toBe("$1,235");
		expect(formatChange(12, 8)).toBe("↑ 50%");
		expect(formatChange(6, 8)).toBe("↓ 25%");
		expect(formatChange(3, 0)).toBe("new");
		expect(formatChange(8, 8)).toBe("");
		expect(formatChange(8, undefined)).toBe("");
	});

	test("escapes the workspace name and leaves out what it does not know", () => {
		const email = buildUsageDigestEmail(data);
		expect(email.subject).toBe("Your week in Acme <Labs> · Oct 5 to Oct 11");
		expect(email.html).toContain("Your week from Oct 5 to Oct 11");
		expect(email.html).not.toContain("Invite your team");
		expect(email.html).toContain("Acme &lt;Labs&gt;");
		expect(email.html).not.toContain("Acme <Labs>");
		expect(email.html).not.toContain("API errors");
		expect(email.text).toContain("Sessions: 12 (↑ 50%)");
		expect(email.text).toContain("Busiest: Monday, 10m");
		expect(email.text).not.toContain("Active members");
	});

	test("shows the team beside a member who had no sessions", () => {
		const email = buildUsageDigestEmail({
			...data,
			you: null,
			team: { ...section, activeMembers: 3, previousActiveMembers: 2 },
		});
		expect(email.text).toContain("You had no sessions this week.");
		expect(email.text).toContain("Active members: 3");
		expect(email.text).toContain(data.unsubscribeUrl);
	});

	test("asks a member alone in the workspace to invite their team", () => {
		const inviteUrl = "https://opaline.so/acme/settings/members";
		const email = buildUsageDigestEmail({ ...data, inviteUrl });
		expect(email.html).toContain("Invite your team");
		expect(email.html).toContain(inviteUrl);
		expect(email.text).toContain(inviteUrl);
	});
});
