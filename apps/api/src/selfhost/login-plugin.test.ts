import { expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
	SELF_HOSTED_LOGIN_PATH,
	selfHostedLoginPlugin,
} from "./login-plugin.js";

const USER_ID = "user-1";
const LOGIN_LINK_INVALID = "/login?error=LOGIN_LINK_INVALID";

function createLoginAuth(
	baseURL: string,
	links: Record<string, string>,
	options: { refuseSessions?: boolean } = {},
) {
	const tables: Record<string, Record<string, unknown>[]> = {
		account: [],
		session: [],
		user: [
			{
				id: USER_ID,
				name: "Ada",
				email: "ada@example.com",
				emailVerified: true,
				image: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		],
		verification: [],
	};
	const consumed: string[] = [];
	const auth = betterAuth({
		baseURL,
		database: memoryAdapter(tables),
		secret: "self-hosted-login-test-secret-0123456789",
		plugins: [
			selfHostedLoginPlugin(async (token) => {
				consumed.push(token);
				const userId = links[token] ?? null;
				delete links[token];
				return userId;
			}),
		],
		databaseHooks: options.refuseSessions
			? { session: { create: { before: async () => false } } }
			: undefined,
	});
	const login = (search: string) =>
		auth.handler(
			new Request(`${baseURL}/api/auth${SELF_HOSTED_LOGIN_PATH}${search}`),
		);
	return { auth, consumed, login, sessions: () => tables.session ?? [] };
}

async function withSelfHosted<T>(
	value: string | undefined,
	run: () => Promise<T>,
): Promise<T> {
	const previous = process.env.OPALINE_SELF_HOSTED;
	if (value === undefined) delete process.env.OPALINE_SELF_HOSTED;
	else process.env.OPALINE_SELF_HOSTED = value;
	try {
		return await run();
	} finally {
		if (previous === undefined) delete process.env.OPALINE_SELF_HOSTED;
		else process.env.OPALINE_SELF_HOSTED = previous;
	}
}

test("a link signs its user in once, with a session cookie that follows the server's scheme", async () => {
	for (const [baseURL, cookieName, secure] of [
		["http://localhost:4100", "better-auth.session_token", false],
		["https://opaline.acme.lan", "__Secure-better-auth.session_token", true],
	] as const) {
		const { auth, consumed, login, sessions } = createLoginAuth(baseURL, {
			"link-token": USER_ID,
		});

		const response = await withSelfHosted("1", () =>
			login("?token=link-token"),
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/");
		expect(consumed).toEqual(["link-token"]);
		expect(sessions()).toHaveLength(1);
		expect(sessions()[0]?.userId).toBe(USER_ID);
		const setCookie = response.headers.get("set-cookie") ?? "";
		expect(setCookie.startsWith(`${cookieName}=`)).toBe(true);
		expect(/;\s*Secure/iu.test(setCookie)).toBe(secure);
		const cookie = setCookie.split(";")[0] ?? "";
		const session = await auth.api.getSession({
			headers: new Headers({ cookie }),
		});
		expect(session?.user.id).toBe(USER_ID);

		const reused = await withSelfHosted("1", () => login("?token=link-token"));
		expect(reused.status).toBe(302);
		expect(reused.headers.get("location")).toBe(LOGIN_LINK_INVALID);
		expect(reused.headers.get("set-cookie")).toBeNull();
		expect(sessions()).toHaveLength(1);
	}
});

test("missing, unknown and orphaned links and refused sessions go back to the login page without a session", async () => {
	const { consumed, login, sessions } = createLoginAuth(
		"http://localhost:4100",
		{ "orphan-token": "deleted-user" },
	);
	const refusing = createLoginAuth(
		"http://localhost:4100",
		{ "link-token": USER_ID },
		{ refuseSessions: true },
	);

	const responses = await withSelfHosted("1", () =>
		Promise.all([
			login(""),
			login("?token=unknown-token"),
			login("?token=orphan-token"),
			refusing.login("?token=link-token"),
		]),
	);

	for (const response of responses) {
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(LOGIN_LINK_INVALID);
		expect(response.headers.get("set-cookie")).toBeNull();
	}
	expect([...consumed].sort()).toEqual(["orphan-token", "unknown-token"]);
	expect(refusing.consumed).toEqual(["link-token"]);
	expect(sessions()).toEqual([]);
	expect(refusing.sessions()).toEqual([]);
});

test("without the self-hosted switch the endpoint does not exist and no link is spent", async () => {
	const { consumed, login, sessions } = createLoginAuth(
		"http://localhost:4100",
		{ "link-token": USER_ID },
	);

	const response = await withSelfHosted(undefined, () =>
		login("?token=link-token"),
	);

	expect(response.status).toBe(404);
	expect(response.headers.get("set-cookie")).toBeNull();
	expect(consumed).toEqual([]);
	expect(sessions()).toEqual([]);
});
