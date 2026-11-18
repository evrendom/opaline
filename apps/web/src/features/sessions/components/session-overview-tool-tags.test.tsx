import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionOverviewToolTags } from "./session-overview-tool-tags";

describe("SessionOverviewToolTags", () => {
	it("shows the first skill and MCP server with a count of the rest", () => {
		const { container } = render(
			<SessionOverviewToolTags
				skills={["ui", "tdd", "diagnose"]}
				mcpServers={["opaline"]}
			/>,
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
	});

	it("renders nothing without skills or MCP servers", () => {
		const { container } = render(
			<SessionOverviewToolTags skills={[]} mcpServers={undefined} />,
		);
		expect(
			container.querySelector("[data-session-overview-tool-tag]"),
		).toBeNull();
	});
});
