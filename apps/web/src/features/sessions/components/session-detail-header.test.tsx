import { SessionDetailOverviewSchema } from "@rudel/api-routes";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionDetailHeader } from "./session-detail-header";
import { buildSessionDetailOverviewViewModel } from "./session-detail-overview-model";

describe("SessionDetailHeader", () => {
	it("places close and fullscreen controls before the session breadcrumb", () => {
		const overview = SessionDetailOverviewSchema.parse({
			activityTotals: {
				edit: 0,
				error: 0,
				read: 0,
				signal: 0,
				signalScanVersion: 1,
				skill: 0,
				subagent: 0,
				write: 0,
			},
			revision: "2026-08-16T08:30:00.123Z",
			session: {
				durationMinutes: 90,
				estimatedCost: 470.945,
				gitBranch: "feature/context-strip",
				gitSha: "abcdef1234567890",
				inputTokens: 1_000,
				lastInteractionDate: "2026-08-16T09:30:00.123Z",
				modelUsed: "gpt-5.6-sol",
				outputTokens: 200,
				projectPath: "/src/rudel",
				repository: "rudel/rudel",
				sessionDate: "2026-08-16T08:00:00.123Z",
				sessionId: "session-1",
				skills: [],
				slashCommands: [],
				source: "codex",
				totalTokens: 1_200,
				userId: "owner-1",
			},
			subagents: [],
			turnPage: { items: [], nextCursor: null, total: 0 },
		});
		const viewModel = buildSessionDetailOverviewViewModel(overview, {
			"owner-1": "Owner",
		});

		const onClose = vi.fn();
		const onToggleFullscreen = vi.fn();

		render(
			<SessionDetailHeader
				avatarMap={{}}
				displayControls={{
					isFullscreen: false,
					onClose,
					onToggleFullscreen,
				}}
				headerRef={() => undefined}
				hideMetrics
				isLoading={false}
				navigation={{
					hasNextSession: true,
					hasPreviousSession: true,
					onNextSession: vi.fn(),
					onPreviousSession: vi.fn(),
				}}
				portalHost={document.body}
				position={3}
				sessionId="session-1"
				totalSessions={8}
				viewModel={viewModel}
			/>,
		);

		const breadcrumb = screen.getByRole("navigation", {
			name: "Session breadcrumb",
		});
		const closeButton = screen.getByRole("button", { name: "Close session" });
		const fullscreenButton = screen.getByRole("button", {
			name: "Expand session detail",
		});
		expect(
			closeButton.compareDocumentPosition(breadcrumb) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			fullscreenButton.compareDocumentPosition(breadcrumb) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		fireEvent.click(closeButton);
		fireEvent.click(fullscreenButton);
		expect(onClose).toHaveBeenCalledOnce();
		expect(onToggleFullscreen).toHaveBeenCalledOnce();
		expect(
			within(breadcrumb)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual([
			"rudel/rudel",
			"feature/context-strip",
			"abcdef12",
			"session-1",
		]);
		expect(
			screen.getByRole("button", { name: "Previous session" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Next session" })).toBeTruthy();
		expect(screen.getByText("3 / 8")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Session information" }),
		).toBeNull();
	});
});
