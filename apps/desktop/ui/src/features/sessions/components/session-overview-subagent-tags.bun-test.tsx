import { expect, test } from "bun:test";
import { SessionAnalyticsSchema } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import seed from "@/features/demo/seed.json";
import {
	getSessionOverviewSubagentCount,
	SessionOverviewSubagentCountTag,
	SessionOverviewSubagentTag,
} from "./session-overview-subagent-tags";

const session = SessionAnalyticsSchema.parse(seed.sessions[0]);

test("a parent shows a ghost tag with how many subagents it ran", () => {
	const markup = renderToStaticMarkup(
		<SessionOverviewSubagentCountTag
			session={{ ...session, subagent_count: 12 }}
		/>,
	);
	expect(markup).toContain('data-session-overview-subagent-count="12"');
	expect(markup).toContain('title="12 subagents"');
	expect(markup).toContain(">12</span>");
	expect(markup).not.toContain("×");
	expect(markup).not.toContain("12x");
});

test("counts native and linked subagents together", () => {
	expect(
		getSessionOverviewSubagentCount({
			...session,
			subagent_count: 2,
			native_child_sessions: [
				{ model: "gpt-5.6-sol", session_id: "a" },
				{ model: "gpt-5.6-sol", session_id: "b" },
				{ model: "gpt-5.6-sol", session_id: "c" },
			],
			linked_subagent_count: 1,
		}),
	).toBe(4);
});

test("a session without subagents shows no tag", () => {
	expect(
		renderToStaticMarkup(
			<SessionOverviewSubagentCountTag
				session={{
					...session,
					subagent_count: 0,
					subagent_types: [],
					native_subagents: [],
					native_child_sessions: [],
					linked_subagent_count: 0,
					linked_subagents: [],
				}}
			/>,
		),
	).toBe("");
});

test("a subagent row says it is a subagent", () => {
	const markup = renderToStaticMarkup(
		<SessionOverviewSubagentTag
			subagentOf={{
				agent_id: "a1",
				kind: "agent",
				session_id: "parent",
				source: "claude_code",
			}}
		/>,
	);
	expect(markup).toContain('data-session-overview-subagent-tag="agent"');
	expect(markup).toContain("Subagent");
});
