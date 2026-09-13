import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionOverviewSubagentMetric } from "./session-overview-subagent-metric";

describe("session overview subagent metric", () => {
	test("renders native and linked provider glyphs from their real models", () => {
		const markup = renderToStaticMarkup(
			<>
				<SessionOverviewSubagentMetric
					source="claude_code"
					subagent_count={1}
					subagent_types={["general-purpose"]}
					linked_subagent_count={1}
					linked_subagents={[
						{
							confidence: "prompt_echo",
							model: "gpt-5.5",
							provider: "openai",
							session_id: "codex-child",
							source: "codex",
						},
					]}
				/>
				<SessionOverviewSubagentMetric
					source="codex"
					subagent_count={1}
					subagent_types={["reviewer"]}
					linked_subagent_count={1}
					linked_subagents={[
						{
							confidence: "prompt_echo",
							model: "claude-fable-5",
							provider: "claude",
							session_id: "fable-child",
							source: "claude",
						},
					]}
				/>
			</>,
		);

		expect(markup.match(/data-subagent-kind="native"/gu)).toHaveLength(2);
		expect(markup.match(/data-subagent-kind="linked"/gu)).toHaveLength(2);
		expect(markup).toContain('data-subagent-model="gpt-5.5"');
		expect(markup).toContain('data-subagent-model="claude-fable-5"');
		expect(markup.match(/viewBox="0 0 1200 1200"/gu)).toHaveLength(2);
		expect(markup.match(/viewBox="0 0 320 320"/gu)).toHaveLength(2);
		expect(markup.match(/>2<\/p>/gu)).toHaveLength(2);
	});

	test("uses the neutral bot glyph for an unknown linked model", () => {
		const markup = renderToStaticMarkup(
			<SessionOverviewSubagentMetric
				source="codex"
				subagent_count={0}
				subagent_types={[]}
				linked_subagent_count={1}
				linked_subagents={[
					{
						confidence: "id_echo",
						model: "vendor-model-x",
						provider: "openai",
						session_id: "unknown-child",
						source: "codex",
					},
				]}
			/>,
		);

		expect(markup).toContain('data-subagent-model="vendor-model-x"');
		expect(markup).toContain('data-trace-hugeicon="true"');
	});
});
