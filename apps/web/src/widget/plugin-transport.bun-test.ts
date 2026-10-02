import { expect, test } from "bun:test";
import { createORPCClient, ORPCError } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "@rudel/api-routes";
import {
	createPluginLink,
	pluginToolCall,
	readToolResult,
} from "./plugin-transport";

test("maps the actual oRPC client path, input, workspace and abort signal to tools/call", async () => {
	const calls: unknown[] = [];
	const controller = new AbortController();
	const client = createORPCClient<ContractRouterClient<typeof contract>>(
		createPluginLink(
			async (name, args, signal) => {
				calls.push({ name, args, signal });
				return { result: { revision: "revision-1" } };
			},
			() => "team",
		),
	);
	const result: unknown = await client.analytics.sessions.detailInitial(
		{ sessionId: "session-1" },
		{ signal: controller.signal },
	);
	expect(result).toEqual({ revision: "revision-1" });
	expect(calls).toEqual([
		{
			name: "app_analytics__sessions__detailInitial",
			args: { workspace: "team", sessionId: "session-1" },
			signal: controller.signal,
		},
	]);
});

test("preserves arrays and typed errors instead of changing procedure results", async () => {
	const link = createPluginLink(
		async () => ({ result: ["session-1"] }),
		() => "team",
	);
	expect(
		await link.call(["analytics", "sessions", "list"], {}, { context: {} }),
	).toEqual(["session-1"]);
	const error = {
		code: "FORBIDDEN",
		status: 403,
		message: "Owner access required",
		data: { reason: "role" },
	};
	expect(() =>
		readToolResult({ isError: true, structuredContent: { error } }),
	).toThrow(new ORPCError(error.code, error));
	expect(() => readToolResult({})).toThrow("Invalid host tool response.");
});

test("no-input reads have closed workspace arguments; input cannot override the bound workspace", () => {
	expect(
		pluginToolCall(["analytics", "skills", "list"], undefined, "team"),
	).toEqual({
		name: "app_analytics__skills__list",
		arguments: { workspace: "team" },
	});
	expect(
		pluginToolCall(
			["analytics", "overview", "costs"],
			{ workspace: "other", startDate: "2026-09-01" },
			"team",
		).arguments,
	).toEqual({ workspace: "team", startDate: "2026-09-01" });
	expect(() =>
		pluginToolCall(["analytics.sessions", "list"], {}, "team"),
	).toThrow();
	expect(() =>
		pluginToolCall(["analytics", "sessions", "list"], [], "team"),
	).toThrow();
});
