import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionReaderBody } from "../model/session-reader-model";
import type { AgentItem } from "../model/session-reader-run-steps";
import {
	type ReaderSubagents,
	ReaderSubagentsContext,
	useReaderSubagentBranches,
} from "./use-reader-subagent-branches";

const fetched = vi.hoisted(() => ({
	content: new Map<string, (answer: unknown) => void>(),
	trace: new Map<string, (answer: unknown) => void>(),
}));

vi.mock("../../components/session-detail-fast-query", async (original) => ({
	...(await original<
		typeof import("../../components/session-detail-fast-query")
	>()),
	fetchSessionDetailSubagent: (input: { subagentId: string }) =>
		new Promise((resolve) => fetched.content.set(input.subagentId, resolve)),
	fetchSessionDetailSubagentTrace: (input: { subagentId: string }) =>
		new Promise((resolve) => fetched.trace.set(input.subagentId, resolve)),
}));

vi.mock("@/features/workspace/organization/useOrganization", () => ({
	useOrganization: () => ({ state: { activeOrg: null } }),
}));

const AT = "2026-10-01T10:00:00.000Z";

function launch(subagentId: string, id: string) {
	return {
		id,
		input: { prompt: subagentId },
		kind: "tool" as const,
		result: { content: "done", isError: false, subagentId },
		timestamp: AT,
		toolName: "Task",
	};
}

const body: SessionReaderBody = {
	responseItems: [
		{
			events: [launch("s1", "call-1"), launch("s2", "call-2")],
			executionMode: "default",
			id: "agent-1",
			kind: "agent",
			timestamp: AT,
		},
	],
	userItems: [],
};

const s1Item: AgentItem = {
	events: [
		{
			id: "read-1",
			input: { file_path: "/repo/a.ts" },
			kind: "tool",
			timestamp: AT,
			toolName: "Read",
		},
	],
	executionMode: "default",
	id: "s1-agent",
	kind: "agent",
	timestamp: AT,
};

const s2Content = [
	{
		message: {
			content: [
				{
					id: "toolu_s2",
					input: { file_path: "/repo/b.ts" },
					name: "Read",
					type: "tool_use",
				},
			],
			role: "assistant",
		},
		sessionId: "s2",
		timestamp: AT,
		type: "assistant",
		uuid: "s2-assistant",
	},
	{
		message: {
			content: [{ content: "b", tool_use_id: "toolu_s2", type: "tool_result" }],
			role: "user",
		},
		sessionId: "s2",
		timestamp: "2026-10-01T10:00:02.000Z",
		type: "user",
		uuid: "s2-user",
	},
]
	.map((line) => JSON.stringify(line))
	.join("\n");

const context: ReaderSubagents = {
	onStaleRevision: () => {},
	revision: "r1",
	sessionId: "session-1",
	subagents: [
		{ hasTranscript: true, subagentId: "s1" },
		{ hasTranscript: true, subagentId: "s2" },
	] as ReaderSubagents["subagents"],
};

beforeEach(() => {
	fetched.content.clear();
	fetched.trace.clear();
});

function renderBranches() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ReaderSubagentsContext.Provider value={context}>
				{children}
			</ReaderSubagentsContext.Provider>
		</QueryClientProvider>
	);
	return renderHook(() => useReaderSubagentBranches(body, true), { wrapper });
}

async function answer(
	from: Map<string, (answer: unknown) => void>,
	subagentId: string,
	value: unknown,
) {
	const resolve = from.get(subagentId);
	expect(resolve, `asked for ${subagentId}`).toBeDefined();
	await act(async () => {
		resolve?.(value);
		for (let tick = 0; tick < 5; tick++)
			await new Promise((done) => setTimeout(done, 0));
	});
}

describe("useReaderSubagentBranches", () => {
	it("hands back one map per set of fetched steps, the same one between", async () => {
		const view = renderBranches();
		const empty = view.result.current;
		expect(empty.size).toBe(0);
		view.rerender();
		expect(view.result.current).toBe(empty);

		await answer(fetched.trace, "s1", {
			items: [s1Item],
			revision: "r1",
			subagentId: "s1",
		});
		const one = view.result.current;
		expect([...one.keys()]).toEqual(["s1"]);
		expect(one.get("s1")?.[0]?.events[0]).toMatchObject({
			activity: { verb: expect.any(String) },
			toolName: "Read",
		});
		view.rerender();
		view.rerender();
		expect(view.result.current).toBe(one);

		await answer(fetched.trace, "s2", null);
		expect(view.result.current).toBe(one);
		await answer(fetched.content, "s2", {
			content: s2Content,
			revision: "r1",
			subagentId: "s2",
		});
		const both = view.result.current;
		expect(both).not.toBe(one);
		expect([...both.keys()]).toEqual(["s1", "s2"]);
		expect(both.get("s1")).toBe(one.get("s1"));
		view.rerender();
		expect(view.result.current).toBe(both);
	});

	it("reads a subagent's raw transcript into its agent's steps when it has no trace", async () => {
		const view = renderBranches();
		await answer(fetched.trace, "s2", null);
		await answer(fetched.content, "s2", {
			content: s2Content,
			revision: "r1",
			subagentId: "s2",
		});
		const steps = view.result.current.get("s2") ?? [];
		expect(steps).toEqual([
			{
				events: [
					{
						activity: {
							actions: [
								{ kind: "reading", targets: ["/repo/b.ts"], verb: "Read" },
							],
							files: [{ operation: "read", path: "/repo/b.ts" }],
							kind: "reading",
							label: "/repo/b.ts",
							skills: [],
							status: "succeeded",
							verb: "Read",
						},
						id: "s2-assistant-0",
						input: { file_path: "/repo/b.ts" },
						kind: "tool",
						nativeId: "toolu_s2",
						provider: "claude",
						result: {
							content: "b",
							isError: false,
							timestamp: "2026-10-01T10:00:02.000Z",
						},
						timestamp: AT,
						toolName: "Read",
					},
				],
				executionMode: "unknown",
				id: "s2-assistant",
				kind: "agent",
				provider: "claude",
				timestamp: AT,
			},
		]);
	});
});
