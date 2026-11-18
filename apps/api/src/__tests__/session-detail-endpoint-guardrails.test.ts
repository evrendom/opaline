import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import {
	throwSessionDetailRevisionError,
	throwSessionDetailWindowError,
} from "../handlers/analytics/session-detail-errors.js";
import { SessionDetailStaleRevisionError } from "../services/session-detail.service.js";
import {
	SessionDetailAnchorNotFoundError,
	SessionDetailBodyTooLargeError,
} from "../services/session-detail-derivation.service.js";

const handlersSource = await Bun.file(
	new URL("../handlers/analytics/sessions.ts", import.meta.url),
).text();

function handlerSource(
	name:
		| "detailBodyChunk"
		| "detailInitial"
		| "detailOverview"
		| "detailSpine"
		| "detailSubagent"
		| "detailTurn"
		| "detailWindow",
) {
	const start = handlersSource.indexOf(`const ${name} =`);
	const end = handlersSource.indexOf("\nconst ", start + 1);
	return handlersSource.slice(start, end === -1 ? undefined : end);
}

describe("session detail endpoint guardrails", () => {
	test("body chunks check the revision the overview hands out, live first", async () => {
		const service = await Bun.file(
			new URL("../services/session-detail.service.ts", import.meta.url),
		).text();
		const start = service.indexOf(
			"export async function getSessionDetailBodyChunk(",
		);
		const body = service.slice(start, service.indexOf("\n}\n", start));
		expect(body).toContain("await getCurrentRevision(input)");
		expect(body).not.toContain("getSessionDetailCurrentRevision(");
	});

	test("removes the legacy full-transcript endpoint and query", async () => {
		const [contractSource, serviceSource] = await Promise.all([
			Bun.file(
				new URL(
					"../../../../packages/api-routes/src/index.ts",
					import.meta.url,
				),
			).text(),
			Bun.file(
				new URL("../services/session-analytics.service.ts", import.meta.url),
			).text(),
		]);

		expect(handlersSource).not.toContain(
			"const detail = os.analytics.sessions.detail",
		);
		expect(contractSource).not.toContain(
			"detail: oc.input(SessionDetailInputSchema)",
		);
		expect(serviceSource).not.toContain(
			"export async function getSessionDetail(",
		);
	});

	test("compression wraps the matched RPC response path", async () => {
		const serverSource = await Bun.file(
			new URL("../handler.ts", import.meta.url),
		).text();
		const rpcBranch = serverSource.slice(
			serverSource.indexOf("rpcHandler.handle(request"),
			serverSource.indexOf("// Static file serving"),
		);
		expect(rpcBranch).toContain("maybeCompressSessionDetailRpcResponse(");
		// The compressor only matches /rpc/... paths; wiring it anywhere else
		// (as previously happened on the /api/auth branch) is dead code.
		expect(
			serverSource.split("maybeCompressSessionDetailRpcResponse(").length,
		).toBe(2);
	});

	for (const name of [
		"detailBodyChunk",
		"detailInitial",
		"detailOverview",
		"detailSpine",
		"detailSubagent",
		"detailTurn",
		"detailWindow",
	] as const) {
		test(`${name} performs organization membership and session ownership checks`, () => {
			const source = handlerSource(name);
			expect(source).toContain(".use(orgMiddleware)");
			expect(source).toContain("await getSessionDetailOwner(");
			expect(source).toContain("requireSessionDetailOwnerAccess(");
		});
	}

	test("the detail owner is the upload's, or before an upload the live session's", () => {
		const start = handlersSource.indexOf(
			"async function getSessionDetailOwner(",
		);
		const source = handlersSource.slice(
			start,
			handlersSource.indexOf("\nconst ", start),
		);
		expect(source).toContain("await getSessionOwner(");
		expect(source).toContain("await readLiveSession(");
		expect(source).toContain("readableSessionOwner(reader)");
	});

	test("each body endpoint forwards the caller-bound revision", () => {
		for (const name of [
			"detailBodyChunk",
			"detailSpine",
			"detailSubagent",
			"detailTurn",
		] as const) {
			expect(handlerSource(name)).toContain("revision: input.revision");
			expect(handlerSource(name)).toContain(
				"throwSessionDetailRevisionError(error, errors)",
			);
		}
	});

	test("maps a missing window anchor to the contract-defined 404 error", () => {
		const errors = {
			ANCHOR_NOT_FOUND: (options: {
				data: { revision: string; turnId: string };
			}) =>
				new ORPCError("ANCHOR_NOT_FOUND", {
					data: options.data,
					defined: true,
					status: 404,
				}),
			STALE_REVISION: (options: {
				data: { currentRevision: string; requestedRevision: string };
			}) =>
				new ORPCError("STALE_REVISION", {
					data: options.data,
					defined: true,
					status: 409,
				}),
		};

		expect(() =>
			throwSessionDetailWindowError(
				new SessionDetailAnchorNotFoundError(
					"removed-turn",
					"117158864486400000",
				),
				errors,
			),
		).toThrow(
			expect.objectContaining({
				code: "ANCHOR_NOT_FOUND",
				data: {
					revision: "117158864486400000",
					turnId: "removed-turn",
				},
				status: 404,
			}),
		);
	});

	test("maps a body revision mismatch to the contract-defined 409 error", () => {
		// Mirrors the constructor map oRPC builds from SESSION_DETAIL_REVISION_ERRORS:
		// the declared status and defined=true must survive the mapping, since a
		// bare ORPCError would surface as an undefined 500 to clients.
		const errors = {
			STALE_REVISION: (options: {
				data: { currentRevision: string; requestedRevision: string };
			}) =>
				new ORPCError("STALE_REVISION", {
					data: options.data,
					defined: true,
					message: "The session detail revision is stale.",
					status: 409,
				}),
		};

		try {
			throwSessionDetailRevisionError(
				new SessionDetailStaleRevisionError(
					"117158864486400000",
					"117158864486400001",
				),
				errors,
			);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError);
			const rpcError = error as {
				code: string;
				data: unknown;
				defined: boolean;
				status: number;
			};
			expect(rpcError.code).toBe("STALE_REVISION");
			expect(rpcError.status).toBe(409);
			expect(rpcError.defined).toBe(true);
			expect(rpcError.data).toEqual({
				currentRevision: "117158864486400001",
				requestedRevision: "117158864486400000",
			});
		}
	});

	test("maps oversized individual bodies to a 413", () => {
		const errors = {
			STALE_REVISION: (options: {
				data: { currentRevision: string; requestedRevision: string };
			}) =>
				new ORPCError("STALE_REVISION", {
					data: options.data,
					defined: true,
					status: 409,
				}),
		};
		try {
			throwSessionDetailRevisionError(
				new SessionDetailBodyTooLargeError("turn"),
				errors,
			);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError);
			expect(error).toMatchObject({
				code: "PAYLOAD_TOO_LARGE",
				status: 413,
			});
		}
	});
});
