import { expect, test } from "bun:test";
import { SessionAnalyticsSchema } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import seed from "@/features/demo/seed.json";
import {
	getSessionOverviewSubagents,
	SessionOverviewSubagentStack,
} from "./session-overview-subagent-stack";

const session = SessionAnalyticsSchema.parse(seed.sessions[0]);

test("recognizes Claude shorthand and OpenAI reasoning model names", () => {
	for (const model of [
		"sonnet",
		"opus",
		"haiku",
		"anthropic/sonnet-4",
		"Claude Fable 5",
	]) {
		expect(getModelIconComponent(model)).toBe(ClaudeModelIcon);
	}
	for (const model of [
		"gpt-5.6-sol",
		"chatgpt",
		"codex",
		"o3",
		"openai/o4-mini",
	]) {
		expect(getModelIconComponent(model)).toBe(CodexModelIcon);
	}
});

test("uses a bot for unknown models without guessing a vendor", () => {
	const markup = renderToStaticMarkup(
		<SessionOverviewSubagentStack
			session={{
				...session,
				subagent_count: 3,
				native_subagents: [
					{ subagent_id: "a", model: null },
					{ subagent_id: "b", model: "kimi-k2" },
					{ subagent_id: "c", model: "cursor-composer" },
				],
			}}
		/>,
	);
	expect(markup.match(/data-subagent-icon-kind="bot"/gu)).toHaveLength(3);
	expect(markup.match(/data-trace-glyph/gu)).toHaveLength(3);
	expect(markup).toContain("Model unavailable");
	expect(getModelIconComponent("kimi-k2")).toBeNull();
	expect(getModelIconComponent("cursor-composer")).toBeNull();
});

test("renders one overlapping icon per subagent using its own model", () => {
	const markup = renderToStaticMarkup(
		<SessionOverviewSubagentStack
			session={{
				...session,
				subagent_count: 3,
				native_subagents: [
					{ subagent_id: "a", model: "claude-sonnet-4" },
					{ subagent_id: "b", model: "gpt-5.6-sol" },
					{ subagent_id: "c", model: "claude-opus-4" },
				],
			}}
		/>,
	);
	expect(markup.match(/data-subagent-model-icon/gu)).toHaveLength(3);
	expect(markup.match(/data-subagent-icon-kind="model"/gu)).toHaveLength(3);
	expect(markup).toContain('data-subagent-model="claude-sonnet-4"');
	expect(markup).toContain('data-subagent-model="gpt-5.6-sol"');
	expect(markup).toContain('data-subagent-model="claude-opus-4"');
	expect(markup).toContain("--subagent-step:0.5rem");
	expect(markup).toContain("drop-shadow-[0_0_0.75px_rgb(0_0_0_/_14%)]");
	expect(markup).toContain("opaline-trace-fill.svg");
	expect(markup).toContain("flex size-5 items-center justify-center bg-white");
	expect(markup).not.toContain("rounded-full");
});

test("counts native and linked agents separately and never guesses the parent model", () => {
	const agents = getSessionOverviewSubagents({
		...session,
		subagent_count: 2,
		linked_subagent_count: 1,
		linked_subagents: [
			{
				session_id: "child",
				model: "claude-sonnet-4",
				provider: "claude",
				source: "claude",
				confidence: "id_echo",
			},
		],
	});
	expect(agents).toHaveLength(3);
	expect(agents.map((agent) => agent.model)).toEqual([
		null,
		null,
		"claude-sonnet-4",
	]);
});

test("leaves sessions without subagents empty", () => {
	expect(
		renderToStaticMarkup(<SessionOverviewSubagentStack session={session} />),
	).toBe("");
});

test("keeps every glyph in a large stack without widening the model column", () => {
	const markup = renderToStaticMarkup(
		<SessionOverviewSubagentStack
			session={{ ...session, subagent_count: 20 }}
		/>,
	);
	expect(markup.match(/data-subagent-model-icon/gu)).toHaveLength(20);
	expect(markup).toContain("--subagent-stack-width:4rem");
	expect(markup).toContain("Model unavailable");
});
