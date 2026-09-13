import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
	CLI_CONNECTION_PATH,
	CliConnectionAuthorizeSchema,
	CliConnectionIdSchema,
	CliConnectionRedeemSchema,
	CliConnectionSecretSchema,
	CliConnectionUpdateSchema,
} from "@rudel/api-routes";
import { ZodError } from "zod";
import {
	authorizeBrowserCliConnection,
	createCliConnection,
	readBrowserCliConnection,
	redeemCliConnection,
	updateCliConnection,
} from "../services/cli-connection.service.js";
import {
	readCliConnectionListenUrl,
	streamCliConnection,
} from "../services/cli-connection-stream.js";

const COOKIE_NAME = "opaline_cli_browser";
const MAX_CONNECTION_BODY_BYTES = 384_000;

export async function handleCliConnectionRequest(
	request: Request,
	env: {
		readonly allowedOrigins: readonly string[];
		readonly source: string;
		readonly getUserId: (request: Request) => Promise<string | null>;
		readonly getBrowserUserId: (request: Request) => Promise<string | null>;
	},
): Promise<Response> {
	try {
		const url = new URL(request.url);
		const suffix = url.pathname.slice(CLI_CONNECTION_PATH.length);
		const origin = request.headers.get("origin");
		if (suffix === "" && request.method === "POST") {
			if (!origin || !env.allowedOrigins.includes(origin))
				throw new ORPCError("FORBIDDEN");
			readCliConnectionListenUrl();
			const browserToken =
				readBrowserToken(request) ?? randomBytes(32).toString("base64url");
			const result = await createCliConnection({
				browserToken,
				source: env.source,
				returnOrigin: origin,
			});
			return Response.json(result, {
				headers: {
					"Set-Cookie": `${COOKIE_NAME}=${browserToken}; Path=/api/cli/connections; HttpOnly; SameSite=Lax; Max-Age=86400${url.protocol === "https:" ? "; Secure" : ""}`,
				},
			});
		}
		if (suffix === "/redeem" && request.method === "POST") {
			const input = CliConnectionRedeemSchema.parse(await readBody(request));
			return Response.json(
				await redeemCliConnection(input.code, input.writerToken),
			);
		}
		const match = /^\/([^/]+)(?:\/(events|authorize|update))?$/u.exec(suffix);
		const id = CliConnectionIdSchema.safeParse(match?.[1]);
		if (!match || !id.success) throw new ORPCError("NOT_FOUND");
		if (match[2] === "update" && request.method === "POST") {
			const input = CliConnectionUpdateSchema.parse(await readBody(request));
			const userId =
				input.update.kind === "bind" ? await env.getUserId(request) : null;
			return Response.json(await updateCliConnection(id.data, input, userId));
		}
		const browserToken = readBrowserToken(request);
		if (!browserToken) throw new ORPCError("NOT_FOUND");
		if (!env.allowedOrigins.includes(origin ?? url.origin))
			throw new ORPCError("FORBIDDEN");
		if (match[2] === "authorize" && request.method === "POST") {
			if (!origin) throw new ORPCError("FORBIDDEN");
			const input = CliConnectionAuthorizeSchema.parse(await readBody(request));
			const userId = await env.getBrowserUserId(request);
			if (!userId) throw new ORPCError("UNAUTHORIZED");
			return Response.json(
				await authorizeBrowserCliConnection({
					id: id.data,
					browserToken,
					userId,
					userCode: input.userCode,
					organizationId: input.organizationId,
				}),
			);
		}
		if (request.method === "GET" && match[2] === "events")
			return streamCliConnection(request, id.data, browserToken);
		if (request.method === "GET" && !match[2])
			return Response.json(
				await readBrowserCliConnection(id.data, browserToken),
			);
		return new Response("Method Not Allowed", { status: 405 });
	} catch (error) {
		if (error instanceof ORPCError)
			return Response.json(
				{ error: error.code, message: error.message },
				{ status: error.status },
			);
		if (error instanceof ZodError || error instanceof SyntaxError)
			return Response.json(
				{ error: "BAD_REQUEST", message: "Invalid connection request." },
				{ status: 400 },
			);
		throw error;
	}
}

function readBrowserToken(request: Request): string | null {
	const cookie = request.headers
		.get("cookie")
		?.split(";")
		.find((entry) => entry.trim().startsWith(`${COOKIE_NAME}=`));
	const parsed = CliConnectionSecretSchema.safeParse(
		cookie?.trim().slice(COOKIE_NAME.length + 1),
	);
	return parsed.success ? parsed.data : null;
}

async function readBody(request: Request): Promise<unknown> {
	if (!request.body) throw new ORPCError("BAD_REQUEST");
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_CONNECTION_BODY_BYTES) {
				await reader.cancel();
				throw new ORPCError("PAYLOAD_TOO_LARGE");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
