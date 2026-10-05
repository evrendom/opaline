import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
	isPasswordAuthAllowed,
	type PasswordAuthAllowlist,
	parsePasswordAuthEmails,
	passwordAuthAllowlistPlugin,
} from "../password-auth.js";

const REVIEWER = "openai-review@opaline.so";
const PASSWORD = "correct-horse-battery";
const INVALID_CREDENTIALS = {
	code: "INVALID_EMAIL_OR_PASSWORD",
	message: "Invalid email or password",
};

function createTestAuth(allowlist: PasswordAuthAllowlist) {
	const tables: Record<string, Record<string, unknown>[]> = {
		account: [],
		session: [],
		user: [],
		verification: [],
	};
	const auth = betterAuth({
		baseURL: "http://localhost:4010",
		database: memoryAdapter(tables),
		emailAndPassword: { enabled: true },
		plugins: [passwordAuthAllowlistPlugin(allowlist)],
		secret: "password-auth-test-secret-at-least-32-characters",
	});
	return { auth, users: () => tables.user ?? [] };
}

function post(
	auth: ReturnType<typeof createTestAuth>["auth"],
	path: string,
	body: Record<string, string>,
) {
	return auth.handler(
		new Request(`http://localhost:4010/api/auth${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://localhost:4010",
			},
			body: JSON.stringify(body),
		}),
	);
}

describe("parsePasswordAuthEmails", () => {
	test("allows nobody when the variable is missing", () => {
		const allowlist = parsePasswordAuthEmails(undefined);
		expect(isPasswordAuthAllowed(allowlist, REVIEWER)).toBe(false);
	});

	test("allows nobody when the variable is empty", () => {
		const allowlist = parsePasswordAuthEmails(" , ");
		expect(isPasswordAuthAllowed(allowlist, REVIEWER)).toBe(false);
		expect(isPasswordAuthAllowed(allowlist, "")).toBe(false);
	});

	test("allows everyone with *", () => {
		const allowlist = parsePasswordAuthEmails("*");
		expect(allowlist).toEqual({ kind: "everyone" });
		expect(isPasswordAuthAllowed(allowlist, "anyone@example.com")).toBe(true);
	});

	test("matches exact emails case-insensitively", () => {
		const allowlist = parsePasswordAuthEmails(
			" OpenAI-Review@Opaline.so ,openai-review-sam@opaline.so",
		);
		expect(isPasswordAuthAllowed(allowlist, REVIEWER)).toBe(true);
		expect(
			isPasswordAuthAllowed(allowlist, " OPENAI-REVIEW-SAM@opaline.so"),
		).toBe(true);
		expect(isPasswordAuthAllowed(allowlist, "review@opaline.so")).toBe(false);
		expect(isPasswordAuthAllowed(allowlist, "x.openai-review@opaline.so")).toBe(
			false,
		);
	});

	test("adds extra emails such as the showcase account", () => {
		const allowlist = parsePasswordAuthEmails(undefined, [
			"Demo@Opaline.so",
			undefined,
		]);
		expect(isPasswordAuthAllowed(allowlist, "demo@opaline.so")).toBe(true);
	});
});

describe("password auth allowlist enforcement", () => {
	test("lets an allowed email sign up and sign in with any casing", async () => {
		const { auth, users } = createTestAuth(
			parsePasswordAuthEmails(REVIEWER.toUpperCase()),
		);

		const signUp = await post(auth, "/sign-up/email", {
			email: REVIEWER,
			name: "Reviewer",
			password: PASSWORD,
		});
		const signIn = await post(auth, "/sign-in/email", {
			email: "OpenAI-Review@Opaline.so",
			password: PASSWORD,
		});

		expect(signUp.status).toBe(200);
		expect(signIn.status).toBe(200);
		expect(users()).toHaveLength(1);
	});

	test("lets everyone use a password with *", async () => {
		const { auth } = createTestAuth(parsePasswordAuthEmails("*"));

		const signUp = await post(auth, "/sign-up/email", {
			email: "anyone@example.com",
			name: "Anyone",
			password: PASSWORD,
		});
		const signIn = await post(auth, "/sign-in/email", {
			email: "anyone@example.com",
			password: PASSWORD,
		});

		expect(signUp.status).toBe(200);
		expect(signIn.status).toBe(200);
	});

	test("rejects sign-up for an email off the list without creating a user", async () => {
		const { auth, users } = createTestAuth(parsePasswordAuthEmails(REVIEWER));

		const response = await post(auth, "/sign-up/email", {
			email: "someone@example.com",
			name: "Someone",
			password: PASSWORD,
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(INVALID_CREDENTIALS);
		expect(users()).toHaveLength(0);
	});

	test("answers an off-list sign-in exactly like a wrong password", async () => {
		const { auth } = createTestAuth(parsePasswordAuthEmails("*"));
		await post(auth, "/sign-up/email", {
			email: "someone@example.com",
			name: "Someone",
			password: PASSWORD,
		});
		const wrongPassword = await post(auth, "/sign-in/email", {
			email: "someone@example.com",
			password: "not-the-password",
		});
		const { auth: restricted } = createTestAuth(
			parsePasswordAuthEmails(REVIEWER),
		);

		const offList = await post(restricted, "/sign-in/email", {
			email: "someone@example.com",
			password: PASSWORD,
		});

		expect(offList.status).toBe(wrongPassword.status);
		expect(await offList.json()).toEqual(await wrongPassword.json());
		expect(offList.status).toBe(401);
	});

	test.each([
		["missing", undefined],
		["empty", ""],
	])("rejects every password sign-up when the list is %s", async (_label, value) => {
		const { auth, users } = createTestAuth(parsePasswordAuthEmails(value));

		const response = await post(auth, "/sign-up/email", {
			email: REVIEWER,
			name: "Reviewer",
			password: PASSWORD,
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(INVALID_CREDENTIALS);
		expect(users()).toHaveLength(0);
	});

	test("answers whether an email may use a password", async () => {
		const { auth } = createTestAuth(parsePasswordAuthEmails(REVIEWER));

		const allowed = await post(auth, "/password-sign-in/available", {
			email: "OPENAI-REVIEW@opaline.so",
		});
		const other = await post(auth, "/password-sign-in/available", {
			email: "someone@example.com",
		});

		expect(allowed.status).toBe(200);
		expect(await allowed.json()).toEqual({ available: true });
		expect(await other.json()).toEqual({ available: false });
	});
});
