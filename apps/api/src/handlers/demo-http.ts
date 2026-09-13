import { z } from "zod";

const OrganizationListSchema = z.array(
	z.object({ id: z.string() }).passthrough(),
);
const RpcOrganizationInputSchema = z
	.object({
		json: z
			.object({ organizationId: z.string().optional() })
			.passthrough()
			.optional(),
	})
	.passthrough();

const SessionSchema = z.object({ token: z.string().min(1) });
const READ_AUTH_PATHS = new Set([
	"/api/auth/get-session",
	"/api/auth/organization/get-full-organization",
	"/api/auth/organization/get-active-member",
	"/api/auth/organization/get-active-member-role",
	"/api/auth/organization/list",
	"/api/auth/organization/list-members",
]);
const READ_RPC_PATHS = new Set([
	"/rpc/me",
	"/rpc/listMyOrganizations",
	"/rpc/getOrganizationSessionCount",
	"/rpc/cli/setupStatus",
	"/rpc/cli/authStatus",
]);

// A separate route never forwards visitor cookies or returns the showcase token.
// The same real handlers enforce tenant access and response limits.
export function createDemoHandler(
	fetchApi: (request: Request) => Promise<Response>,
	environment: Readonly<Record<string, string | undefined>> = process.env,
) {
	let session: Promise<string> | undefined;
	async function signIn(origin: string) {
		const email = environment.DEMO_ACCOUNT_EMAIL;
		const password = environment.DEMO_ACCOUNT_PASSWORD;
		const organizationId = environment.DEMO_ORGANIZATION_ID;
		if (!email || !password || !organizationId)
			throw new Error("The showcase account is not configured.");
		const response = await fetchApi(
			new Request(`${origin}/api/auth/sign-in/email`, {
				method: "POST",
				headers: { "content-type": "application/json", origin },
				body: JSON.stringify({ email, password }),
			}),
		);
		if (!response.ok) throw new Error("Showcase authentication failed.");
		const { token } = SessionSchema.parse(await response.json());
		const active = await fetchApi(
			new Request(`${origin}/api/auth/organization/set-active`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin,
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ organizationId }),
			}),
		);
		if (!active.ok) throw new Error("Showcase workspace selection failed.");
		return token;
	}
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const path = url.pathname.replace(
			/^\/api\/demo\/(auth|rpc)(?=\/|$)/u,
			(_, group: string) => (group === "auth" ? "/api/auth" : "/rpc"),
		);
		const readable =
			(request.method === "GET" && READ_AUTH_PATHS.has(path)) ||
			(["GET", "POST"].includes(request.method) &&
				(path.startsWith("/rpc/analytics/") || READ_RPC_PATHS.has(path)));
		if (!readable)
			return Response.json(
				{ message: "Changes are disabled in the demo." },
				{ status: 403 },
			);
		// Organization auth reads accept a destination, so constrain those explicitly.
		for (const [key, value] of url.searchParams) {
			if (
				(key === "organizationId" &&
					value !== environment.DEMO_ORGANIZATION_ID) ||
				key === "organizationSlug"
			)
				return Response.json(
					{ message: "This demo uses the showcase workspace." },
					{ status: 403 },
				);
		}
		let body: ArrayBuffer | undefined;
		if (request.method === "POST") body = await request.arrayBuffer();
		if (path === "/rpc/getOrganizationSessionCount") {
			const raw = body
				? new TextDecoder().decode(body)
				: url.searchParams.get("data");
			let input: unknown;
			try {
				input = JSON.parse(raw || "{}");
			} catch {
				return Response.json(
					{ message: "Invalid demo request." },
					{ status: 400 },
				);
			}
			const parsed = RpcOrganizationInputSchema.safeParse(input);
			if (
				!parsed.success ||
				parsed.data.json?.organizationId !== environment.DEMO_ORGANIZATION_ID
			) {
				return Response.json(
					{ message: "This demo uses the showcase workspace." },
					{ status: 403 },
				);
			}
		}
		const origin = environment.APP_URL || url.origin;
		session ??= signIn(origin).catch((error: unknown) => {
			session = undefined;
			throw error;
		});
		const token = await session;
		const target = new URL(path + url.search, origin);
		const response = await fetchApi(
			new Request(target.href, {
				method: request.method,
				headers: {
					authorization: `Bearer ${token}`,
					origin,
					"content-type": "application/json",
				},
				body,
			}),
		);
		if (response.status === 401) session = undefined;
		const headers = new Headers(response.headers);
		for (const name of [
			"set-cookie",
			"set-auth-token",
			"content-length",
			"content-encoding",
			"transfer-encoding",
		])
			headers.delete(name);
		headers.set("cache-control", "no-store");
		if (path === "/api/auth/get-session" && response.ok) {
			const payload = z
				.object({
					session: z.object({ token: z.string().optional() }).passthrough(),
				})
				.passthrough()
				.parse(await response.json());
			delete payload.session.token;
			delete payload.session.ipAddress;
			delete payload.session.userAgent;
			return Response.json(payload, { headers });
		}
		if (path === "/api/auth/organization/list" && response.ok) {
			const organizations = OrganizationListSchema.parse(await response.json());
			return Response.json(
				organizations.filter(
					(organization) =>
						organization.id === environment.DEMO_ORGANIZATION_ID,
				),
				{ headers },
			);
		}
		if (path === "/rpc/listMyOrganizations" && response.ok) {
			const payload = z
				.object({ json: OrganizationListSchema })
				.passthrough()
				.parse(await response.json());
			payload.json = payload.json.filter(
				(organization) => organization.id === environment.DEMO_ORGANIZATION_ID,
			);
			return Response.json(payload, { headers });
		}
		// Keep the upstream Response alive while consuming its stream. Forwarding
		// response.body through another Response loses RPC payloads on Vercel/Bun.
		return new Response(await response.arrayBuffer(), {
			status: response.status,
			headers,
		});
	};
}
