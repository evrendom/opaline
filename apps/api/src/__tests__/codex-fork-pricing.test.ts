import { expect, test } from "bun:test";
import {
	extractTranscriptUsageMetrics,
	sumSessionRequestCosts,
} from "@rudel/api-routes";
import { extractUsageEvents } from "@rudel/usage-events";
import {
	deriveSessionDetail,
	getSessionDetailOverviewPage,
	type SessionDetailRawSnapshot,
} from "../services/session-detail-derivation.service.js";
import { codexForkFixture } from "./helpers/codex-fork-fixture.js";

function snapshot(content: string): SessionDetailRawSnapshot {
	return {
		content,
		durationMinutes: 0,
		gitBranch: null,
		gitRemote: "",
		gitSha: null,
		inputTokens: 700000000,
		lastInteractionDate: "2026-08-28T19:01:59Z",
		modelUsed: "gpt-5.6-sol",
		organizationId: "test-org",
		outputTokens: 1000000,
		ownerId: "test-user",
		packageName: "",
		projectPath: "/test",
		revision: "1",
		sessionDate: "2026-08-28T19:01:59Z",
		sessionId: "fork-session",
		skills: [],
		slashCommands: [],
		source: "codex",
		subagents: {},
		totalTokens: 701000000,
	};
}

for (const ownUsage of [false, true]) {
	test(`fork pricing excludes parent usage and preserves child usage: ${ownUsage}`, () => {
		const content = codexForkFixture({ ownUsage });
		const events = extractUsageEvents({
			content,
			organizationId: "test-org",
			userId: "test-user",
			sessionId: "fork-session",
			source: "codex",
			subagents: {},
		});
		const metrics = extractTranscriptUsageMetrics(content, undefined);
		expect(events.status).toBe("complete");
		expect(events.events).toHaveLength(ownUsage ? 1 : 0);
		expect(metrics.usageEvents).toHaveLength(ownUsage ? 1 : 0);
		expect(metrics.estimatedCost).toBe(ownUsage ? 0.312 : 0);
		expect(metrics.inputTokens).toBe(ownUsage ? 50000 : 0);
		expect(metrics.outputTokens).toBe(ownUsage ? 5000 : 0);
		const overview = getSessionDetailOverviewPage({
			derivation: deriveSessionDetail(snapshot(content)),
			limit: 100,
		});
		expect(overview.session.estimatedCost).toBe(ownUsage ? 0.312 : 0);
		expect(overview.session.inputTokens).toBe(ownUsage ? 50000 : 0);
		expect(overview.session.outputTokens).toBe(ownUsage ? 5000 : 0);
		expect(overview.session.totalTokens).toBe(ownUsage ? 55000 : 0);
		expect(overview.session.modelUsed).toBe(ownUsage ? "gpt-5.6-sol" : null);
		expect(
			overview.turnPage.items.flatMap((turn) => turn.usageCalls),
		).toHaveLength(ownUsage ? 1 : 0);
	});
}

test("a timestamp burst without parent evidence remains billable", () => {
	const metrics = extractTranscriptUsageMetrics(
		codexForkFixture({ parent: false }),
		undefined,
	);
	expect(metrics.usageEvents).toHaveLength(2);
	expect(metrics.estimatedCost).toBe(0.624);
	expect(metrics.excludedReplayUsageCount).toBeUndefined();
});

test("known zero usage does not hide an unpriced request elsewhere", () => {
	expect(
		sumSessionRequestCosts([{ usageEventCount: 0, estimatedCost: 0 }]),
	).toBe(0);
	expect(
		sumSessionRequestCosts([
			{ usageEventCount: 0, estimatedCost: 0 },
			{ usageEventCount: 1, estimatedCost: null },
		]),
	).toBeNull();
	expect(
		sumSessionRequestCosts([{ usageEventCount: 0, estimatedCost: null }]),
	).toBeNull();
});
