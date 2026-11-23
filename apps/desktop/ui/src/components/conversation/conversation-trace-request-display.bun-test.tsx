import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getTraceCallDisplayConfig } from "./conversation-trace-call-display";
import { AgentTraceRequestDisplay } from "./conversation-trace-tree";

describe("AgentTraceRequestDisplay", () => {
	test("uses the metadata rhythm instead of token pills", () => {
		const markup = renderToStaticMarkup(
			<AgentTraceRequestDisplay
				agentModel="claude-sonnet-4"
				config={getTraceCallDisplayConfig("request")}
				expanded
				index={1}
				presentation="header"
				previousInputTotal={undefined}
				usage={{
					at: "2026-08-13T12:00:00.000Z",
					cacheCreationInputTokens: 100,
					cacheReadInputTokens: 750,
					inputTokens: 150,
					model: "claude-sonnet-4",
					outputTokens: 80,
				}}
			/>,
		);

		expect(markup).toContain("Request 1");
		expect(markup).toContain("IN 1.0k tok");
		expect(markup).toContain("75% cached");
		expect(markup).toContain("OUT 80 tok");
		expect(markup.match(/data-trace-request-separator/g)).toHaveLength(3);
		expect(markup.match(/data-trace-request-metadata="true"/g)).toHaveLength(3);
		expect(markup).toContain("tabular-nums");
		expect(markup).toContain("gap-s");
		expect(markup).not.toContain("corner-full");
		expect(markup).not.toContain("font-medium");
		expect(markup).not.toContain("tracking-s");
		expect(markup).not.toContain("px-m");
		expect(markup).not.toContain("py-xxs");
	});
});
