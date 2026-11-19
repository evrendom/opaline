import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { DataChunk } from "@rudel/api-routes/cli-data";

mock.module("../db.js", () => ({
	sqlClient: () => {
		throw new Error("Postgres is not used here");
	},
	db: {},
}));

const { ORPCError } = await import("@orpc/server");
const { RPCHandler } = await import("@orpc/server/fetch");
const { createORPCClient } = await import("@orpc/client");
const { RPCLink } = await import("@orpc/client/fetch");
const { RETRO_TOOLS_OFF } = await import("../services/analysis/retro-tools.js");
const { clickHouseError, fakeClickHouse, isSummary, summaryRow, teammate } =
	await import("../services/cli-data/cli-data.fixtures.js");
const { createCliDataRouter } = await import("./cli-data.js");

type Answer = Parameters<typeof fakeClickHouse>[0];

const signedIn = {
	user: {
		id: "user-1",
		email: "member@example.com",
		name: "Member",
		emailVerified: true,
		image: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	},
	session: null,
	apiKeyId: "key-1",
	authFailure: null,
	ingestOperatorAuthorized: false,
	requestId: "request-1",
	publicLookupSource: "test",
};

function serve(answer: Answer, context: object = signedIn) {
	const { env, sent } = fakeClickHouse(answer);
	const router = createCliDataRouter({
		...env,
		workspace: async (workspace) => {
			if (workspace === "elsewhere")
				throw new ORPCError("FORBIDDEN", {
					message: "Not a member of the workspace elsewhere",
				});
			return {
				id: workspace === "fresh" ? "ws-fresh" : "ws-1",
				slug: "acme",
				reader: teammate,
				workspaceCreatedAt: "2026-01-01T00:00:00Z",
			};
		},
	});
	const handler = new RPCHandler({ cli: { data: router } });
	const contentTypes: string[] = [];
	const link = new RPCLink({
		url: "http://api.test/rpc",
		fetch: async (request: Request) => {
			const { response } = await handler.handle(request, {
				prefix: "/rpc",
				context: context as never,
			});
			if (!response) throw new Error("no procedure matched");
			contentTypes.push(response.headers.get("Content-Type") ?? "");
			return response;
		},
	});
	const client = createORPCClient(link) as {
		cli: {
			data: {
				sql: (input: unknown) => Promise<AsyncIterable<DataChunk>>;
				pullPlan: (input: unknown) => Promise<{ sessions: unknown[] }>;
				pullTable: (input: unknown) => Promise<AsyncIterable<DataChunk>>;
			};
		};
	};
	return { client, sent, contentTypes };
}

async function drain(iterable: AsyncIterable<DataChunk>): Promise<DataChunk[]> {
	const chunks: DataChunk[] = [];
	for await (const chunk of iterable) chunks.push(chunk);
	return chunks;
}

async function refusal(work: () => Promise<unknown>) {
	try {
		await work();
	} catch (error) {
		return error as { code: string; message: string; data: unknown };
	}
	throw new Error("expected a refusal");
}

const previous = process.env.RETRO_TOOLS_WORKSPACES;
beforeAll(() => {
	process.env.RETRO_TOOLS_WORKSPACES = "ws-1";
});
afterAll(() => {
	if (previous === undefined) delete process.env.RETRO_TOOLS_WORKSPACES;
	else process.env.RETRO_TOOLS_WORKSPACES = previous;
});

describe("cli.data over oRPC", () => {
	test("sql streams its rows as server-sent events and ends with done", async () => {
		const rows = Array.from({ length: 300 }, (_, index) => `["s-${index}"]`);
		const { client, contentTypes } = serve(() => ['["session_id"]', ...rows]);
		const chunks = await drain(
			await client.cli.data.sql({
				query: "SELECT session_id FROM runs",
				format: "jsonl",
			}),
		);
		expect(contentTypes).toEqual(["text/event-stream"]);
		const text = chunks
			.map((chunk) => (chunk.type === "lines" ? chunk.text : ""))
			.join("");
		expect(text.split("\n").filter(Boolean)).toHaveLength(300);
		expect(chunks.at(-1)).toMatchObject({
			type: "done",
			rows: 300,
			columns: ["session_id"],
		});
	});

	test("a refusal while streaming arrives as an error with its code and data", async () => {
		const { client } = serve(() =>
			clickHouseError("TOO_MANY_ROWS_OR_BYTES", "Limit for result exceeded"),
		);
		const refused = await refusal(async () =>
			drain(
				await client.cli.data.sql({
					query: "SELECT session_id FROM runs",
					format: "csv",
				}),
			),
		);
		expect(refused.code).toBe("EXPORT_TOO_LARGE");
		expect(refused.data).toEqual({ maxBytes: 256 * 1024 * 1024 });
	});

	test("pullTable streams the table of the sessions the caller may read", async () => {
		const { client } = serve((sent) =>
			isSummary(sent)
				? [summaryRow("s-1")]
				: ['{"session_id":"s-1","turn_idx":1}'],
		);
		const chunks = await drain(
			await client.cli.data.pullTable({
				workspace: "ws-1",
				table: "runs",
				sessions: ["s-1"],
			}),
		);
		expect(chunks).toEqual([
			{ type: "lines", text: '{"session_id":"s-1","turn_idx":1}\n' },
			{
				type: "done",
				rows: 1,
				bytes: 34,
				columns: ["session_id", "turn_idx"],
				notices: [],
			},
		]);
	});

	test("pullPlan answers in one response and validates its selectors", async () => {
		const { client } = serve((sent) =>
			isSummary(sent) ? [summaryRow("s-1")] : [],
		);
		const plan = await client.cli.data.pullPlan({ from: "2026-11-01" });
		expect(plan.sessions).toHaveLength(1);
		const empty = await refusal(() => client.cli.data.pullPlan({}));
		expect(empty.code).toBe("BAD_REQUEST");
		const backwards = await refusal(() =>
			client.cli.data.pullPlan({ from: "2026-11-05", to: "2026-11-01" }),
		);
		expect(backwards.code).toBe("BAD_REQUEST");
	});

	test("refuses a workspace without the retro tools as the sql tool does", async () => {
		const { client, sent } = serve(() => []);
		for (const call of [
			() =>
				client.cli.data.sql({
					workspace: "fresh",
					query: "SELECT 1",
					format: "jsonl",
				}),
			() =>
				client.cli.data.pullPlan({ workspace: "fresh", from: "2026-11-01" }),
			() =>
				client.cli.data.pullTable({
					workspace: "fresh",
					table: "runs",
					sessions: ["s-1"],
				}),
		]) {
			const refused = await refusal(call);
			expect(refused.code).toBe("FORBIDDEN");
			expect(refused.message).toBe(RETRO_TOOLS_OFF);
		}
		expect(sent).toEqual([]);
	});

	test("refuses non-members and callers without a CLI key", async () => {
		const { client } = serve(() => []);
		const outsider = await refusal(() =>
			client.cli.data.pullPlan({ workspace: "elsewhere", from: "2026-11-01" }),
		);
		expect(outsider.code).toBe("FORBIDDEN");
		const anonymous = serve(() => [], {
			...signedIn,
			user: null,
			apiKeyId: null,
		});
		const unsigned = await refusal(() =>
			anonymous.client.cli.data.pullPlan({ from: "2026-11-01" }),
		);
		expect(unsigned.code).toBe("UNAUTHORIZED");
	});
});
