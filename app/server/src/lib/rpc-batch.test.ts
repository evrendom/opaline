import { describe, expect, test } from "bun:test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { os, type RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import {
	isBatchedRpcProcedure,
	RPC_BATCH_PATH,
	WORKSPACE_REQUEST_HEADER,
} from "@rudel/api-routes/rpc-batch";
import { isStreamedRpcResponse } from "./api-response-size.js";
import { createRpcBatchPlugin, readWorkspaceFromRequest } from "./rpc-batch.js";

interface TestContext {
	requestedWorkspace?: string | null;
}

const base = os.$context<TestContext>();
let releaseSlow: () => void = () => {};

const router = {
	sessionAccess: base.handler(
		({ context }) => context.requestedWorkspace ?? "none",
	),
	analytics: {
		sessions: {
			lastUpload: base.handler(() => "last-upload"),
			liveList: base.handler(
				() =>
					new Promise<string>((resolve) => {
						releaseSlow = () => resolve("live-list");
					}),
			),
			detailInitial: base.handler(() => "detail"),
		},
	},
};

function createClient(workspace: () => string | null) {
	const handler = new RPCHandler(router, {
		plugins: [createRpcBatchPlugin<TestContext>()],
		rootInterceptors: [readWorkspaceFromRequest<TestContext>],
	});
	const responses: Response[] = [];
	const requests: string[] = [];
	const link = new RPCLink({
		url: "http://app.test/rpc",
		headers: () => {
			const slug = workspace();
			return slug ? { [WORKSPACE_REQUEST_HEADER]: slug } : {};
		},
		fetch: async (request) => {
			requests.push(new URL(request.url).pathname);
			const { response } = await handler.handle(request, {
				prefix: "/rpc",
				context: {},
			});
			const result = response ?? new Response(null, { status: 404 });
			responses.push(result);
			return result;
		},
		plugins: [
			new BatchLinkPlugin({
				mode: "streaming",
				url: `http://app.test${RPC_BATCH_PATH}`,
				groups: [
					{
						condition: ({ path }) => isBatchedRpcProcedure(path),
						context: {},
					},
				],
			}),
		],
	});
	return {
		client: createORPCClient<RouterClient<typeof router>>(link),
		requests,
		responses,
	};
}

describe("RPC batching", () => {
	test("the shell's small calls share one streamed request, and a slow one does not hold the rest", async () => {
		const { client, requests, responses } = createClient(() => "acme");
		const order: string[] = [];
		const calls = [
			client.sessionAccess().then((value) => order.push(value)),
			client.analytics.sessions.lastUpload().then((value) => order.push(value)),
			client.analytics.sessions.liveList().then((value) => order.push(value)),
		];
		while (order.length < 2) await new Promise((r) => setTimeout(r, 5));
		expect(order).toEqual(expect.arrayContaining(["acme", "last-upload"]));
		releaseSlow();
		await Promise.all(calls);
		expect(order.at(-1)).toBe("live-list");
		expect(requests).toEqual([RPC_BATCH_PATH]);
		const response = responses[0];
		if (!response) throw new Error("no response");
		expect(isStreamedRpcResponse(RPC_BATCH_PATH, response)).toBe(true);
	});

	test("procedures outside the list go on their own request", async () => {
		const { client, requests } = createClient(() => null);
		const [access, detail] = await Promise.all([
			client.sessionAccess(),
			client.analytics.sessions.detailInitial(),
		]);
		expect(access).toBe("none");
		expect(detail).toBe("detail");
		expect(requests.sort()).toEqual([
			"/rpc/analytics/sessions/detailInitial",
			"/rpc/sessionAccess",
		]);
	});

	test("the server refuses a batched procedure outside the list", async () => {
		const handler = new RPCHandler(router, {
			plugins: [createRpcBatchPlugin<TestContext>()],
		});
		const link = new RPCLink({
			url: "http://app.test/rpc",
			fetch: async (request) =>
				(await handler.handle(request, { prefix: "/rpc", context: {} }))
					.response ?? new Response(null, { status: 404 }),
			plugins: [
				new BatchLinkPlugin({
					url: `http://app.test${RPC_BATCH_PATH}`,
					groups: [{ condition: () => true, context: {} }],
				}),
			],
		});
		const client = createORPCClient<RouterClient<typeof router>>(link);
		const [access, detail] = await Promise.allSettled([
			client.sessionAccess(),
			client.analytics.sessions.detailInitial(),
		]);
		expect(access).toEqual({ status: "fulfilled", value: "none" });
		expect(detail.status).toBe("rejected");
	});

	test("each batched call keeps its own workspace header", async () => {
		let slug = "first";
		const { client, requests } = createClient(() => slug);
		const first = client.sessionAccess();
		slug = "second";
		const second = client.sessionAccess();
		expect(await Promise.all([first, second])).toEqual(["first", "second"]);
		expect(requests).toEqual([RPC_BATCH_PATH]);
	});
});
