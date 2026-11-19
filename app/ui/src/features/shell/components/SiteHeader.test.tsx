import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./SiteHeader";

vi.mock("@/features/sessions/use-session-model", () => ({
	useSessionModel: () => null,
}));

vi.mock("@/features/shell/hooks/use-shell-route-path", () => ({
	useShellRoutePath: () => (path: string) => path,
}));

vi.mock("@/features/shell/hooks/useCurrentShellRoute", () => ({
	useCurrentShellRoute: () => ({
		activeIcon: () => null,
		icon: () => null,
		id: "sessions",
		title: "Sessions",
	}),
}));

vi.mock("@/features/shell/components/WorkspaceMenuButton", () => ({
	WorkspaceMenuButton: () => null,
}));

describe("SiteHeader", () => {
	it("leads from a subagent read on its own back to its run's main thread", () => {
		render(
			<MemoryRouter
				initialEntries={[
					"/session/abc-123?run=r1&turn=r1&subagent=s1&agent=s1&call=e1",
				]}
			>
				<SiteHeader
					setNewseshListPortalHost={() => {}}
					setPortalHost={() => {}}
				/>
			</MemoryRouter>,
		);
		const link = screen.getByRole("link", { name: "abc" });
		const params = new URLSearchParams(
			link.getAttribute("href")?.split("?")[1] ?? "",
		);
		expect(Object.fromEntries(params)).toEqual({
			call: "e1",
			run: "r1",
			turn: "r1",
		});
	});
});
