import { afterEach, expect, mock, test } from "bun:test";

const unused = () => {
	throw new Error("Postgres is not used here");
};
mock.module("../db.js", () => ({
	sqlClient: unused,
	ingestProcessingSqlClient: unused,
	liveSessionSqlClient: unused,
	db: {},
}));

const { handleMcpRoute } = await import("./mcp-http.js");
type Dependencies = Parameters<typeof handleMcpRoute>[2];

const previousSelfHosted = process.env.OPALINE_SELF_HOSTED;
afterEach(() => {
	if (previousSelfHosted === undefined) delete process.env.OPALINE_SELF_HOSTED;
	else process.env.OPALINE_SELF_HOSTED = previousSelfHosted;
});

function unauthorizedChallenge(selfHosted: boolean) {
	if (selfHosted) process.env.OPALINE_SELF_HOSTED = "1";
	else delete process.env.OPALINE_SELF_HOSTED;
	const request = new Request("http://opaline.acme.lan/api/mcp", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
	const auth = {
		api: {
			getMcpSession: async () => null,
			verifyApiKey: async () => ({ valid: false }),
		},
		options: { baseURL: "https://opaline.acme.lan" },
	} as unknown as Dependencies["auth"];
	return handleMcpRoute(request, new URL(request.url), {
		auth,
		allowedOrigins: [],
		publicLookupSource: "test",
		requestId: "request-1",
	});
}

test("behind a TLS proxy a self-hosted server points MCP clients at its https metadata", async () => {
	const response = await unauthorizedChallenge(true);
	expect(response?.status).toBe(401);
	expect(response?.headers.get("www-authenticate")).toBe(
		'Bearer resource_metadata="https://opaline.acme.lan/.well-known/oauth-protected-resource/api/mcp"',
	);
});

test("elsewhere the challenge keeps naming the URL the request came in on", async () => {
	const response = await unauthorizedChallenge(false);
	expect(response?.headers.get("www-authenticate")).toBe(
		'Bearer resource_metadata="http://opaline.acme.lan/.well-known/oauth-protected-resource/api/mcp"',
	);
});
