import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SessionOverviewToolTags } from "./session-overview-tool-tags";

describe("SessionOverviewToolTags", () => {
	it("shows the first skill and MCP server with a count of the rest", () => {
		const { container } = render(
			<MemoryRouter>
				<SessionOverviewToolTags
					skills={["ui", "tdd", "diagnose"]}
					mcpServers={[{ server: "plugin_opaline_opaline", at: 1 }]}
					sessionHref="/w/sessions/s1"
				/>
			</MemoryRouter>,
		);
		const skill = container.querySelector(
			'[data-session-overview-tool-tag="skill"]',
		);
		const mcp = container.querySelector(
			'[data-session-overview-tool-tag="mcp"]',
		);
		expect(skill?.textContent).toContain("ui");
		expect(skill?.textContent).toContain("+2");
		expect(mcp?.textContent).toContain("opaline");
		expect(screen.getByText("Skills: ui, tdd, diagnose")).toBeInTheDocument();
		expect(skill?.getAttribute("role")).toBe("link");
	});

	it("renders nothing without skills or MCP servers", () => {
		const { container } = render(
			<MemoryRouter>
				<SessionOverviewToolTags skills={[]} mcpServers={undefined} />
			</MemoryRouter>,
		);
		expect(
			container.querySelector("[data-session-overview-tool-tag]"),
		).toBeNull();
	});
});
