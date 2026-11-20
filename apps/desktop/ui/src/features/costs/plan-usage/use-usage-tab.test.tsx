import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import {
	type UsageSessions,
	UsageSessionsContext,
} from "../cost-rail-override";
import type { PlanUsageReport, UsageWindow } from "./use-plan-usage";
import { planUsageQueryKey } from "./use-plan-usage";
import { useUsageTab } from "./use-usage-tab";

vi.mock("@/features/desktop/local-app", () => ({
	useLocalDesktopApp: () => true,
}));

const range = { startDate: "2026-11-01", endDate: "2026-11-02" };
const repositories = ["repo-a"];

const window: UsageWindow = {
	window: "weekly",
	label: "Weekly",
	windowMinutes: 10_080,
	usedPercent: 40,
	resetsAt: null,
	checkedAt: "2026-11-02T12:00:00Z",
	recordedFrom: "2026-11-01T00:00:00Z",
	bucketMinutes: 1_440,
	resets: [],
	buckets: [],
	sessions: [],
	sessionPoints: { "session-a": 12, "session-a:agent-1": 4, "session-b": 30 },
	models: [],
	repositories: [],
	otherPoints: 0,
	totalPoints: 255,
	repositoryPoints: 255,
};

const report: PlanUsageReport = {
	from: "2026-11-01T00:00:00Z",
	to: "2026-11-03T00:00:00Z",
	checkedAt: "2026-11-02T12:00:00Z",
	providers: [{ provider: "claude", plan: "max", error: null, window }],
	titles: {},
};

function usageValue(picked: UsageSessions | null | undefined) {
	const client = new QueryClient();
	client.setQueryData(planUsageQueryKey(range, repositories), report);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<MemoryRouter>
			<QueryClientProvider client={client}>
				<UsageSessionsContext.Provider value={picked}>
					{children}
				</UsageSessionsContext.Provider>
			</QueryClientProvider>
		</MemoryRouter>
	);
	const { result } = renderHook(
		() => useUsageTab(range, "daily", true, repositories),
		{ wrapper },
	);
	return result.current.tab?.value;
}

test("the repo Usage card follows the session the rail is filtered to", () => {
	expect(usageValue(undefined)).toBe("255%");
	expect(usageValue({ sessionIds: ["session-a"], share: 1 })).toBe("12%");
	expect(usageValue({ sessionIds: ["session-a", "session-b"], share: 1 })).toBe(
		"42%",
	);
	expect(usageValue({ sessionIds: ["session-unused"], share: 1 })).toBe("0%");
	expect(usageValue(null)).toBe("—");
});

test("a part of a session takes its share of the session's usage", () => {
	expect(usageValue({ sessionIds: ["session-b"], share: 0.25 })).toBe("8%");
	expect(usageValue({ sessionIds: ["session-a"], share: 0.05 })).toBe("0.6%");
});
