import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import {
	createSignUpGate,
	hasValidInvite,
	INVITE_REQUIRED,
	inviteFromRequest,
	isOpenSignup,
} from "./signup-gate.js";

function fakeSql(valid: boolean) {
	const queries: { query: string; values: unknown[] }[] = [];
	const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
		queries.push({
			query: strings.join("?").replace(/\s+/gu, " ").trim(),
			values,
		});
		return Promise.resolve([{ valid }]);
	}) as unknown as postgres.Sql;
	return { sql, queries };
}

const signUp = (headers: Record<string, string> = {}) =>
	new Request("http://localhost:4100/api/auth/sign-up/email", {
		method: "POST",
		headers,
	});

async function refusal(promise: Promise<void>): Promise<unknown> {
	try {
		await promise;
		return null;
	} catch (error) {
		return error;
	}
}

describe("self-hosted sign-up gate", () => {
	test("open sign-up is opted into with OPALINE_OPEN_SIGNUP=1 only", () => {
		expect(isOpenSignup({})).toBe(false);
		expect(isOpenSignup({ OPALINE_OPEN_SIGNUP: "1" })).toBe(true);
		expect(isOpenSignup({ OPALINE_OPEN_SIGNUP: "true" })).toBe(false);
		expect(isOpenSignup({ OPALINE_OPEN_SIGNUP: "0" })).toBe(false);
	});

	test("the invite comes from the x-opaline-invite header, else the opaline_invite cookie", () => {
		expect(inviteFromRequest(undefined)).toBeNull();
		expect(inviteFromRequest(signUp())).toBeNull();
		expect(inviteFromRequest(signUp({ "x-opaline-invite": " abc " }))).toBe(
			"abc",
		);
		expect(
			inviteFromRequest(
				signUp({ cookie: "theme=dark; opaline_invite=tok_1; other=x" }),
			),
		).toBe("tok_1");
		expect(
			inviteFromRequest(
				signUp({ "x-opaline-invite": "head", cookie: "opaline_invite=cook" }),
			),
		).toBe("head");
		expect(
			inviteFromRequest(signUp({ cookie: "xopaline_invite=nope" })),
		).toBeNull();
	});

	test("an invite is a live team link token or a pending invitation for that email", async () => {
		const { sql, queries } = fakeSql(true);
		expect(await hasValidInvite(sql, "token-1", " Bob@Example.com ")).toBe(
			true,
		);
		expect(queries[0]?.query).toContain("FROM team_invite_link");
		expect(queries[0]?.query).toContain("revoked_at IS NULL");
		expect(queries[0]?.query).toContain("FROM invitation");
		expect(queries[0]?.query).toContain("status = 'pending'");
		expect(queries[0]?.values).toEqual([
			createHash("sha256").update("token-1").digest("base64url"),
			"token-1",
			"bob@example.com",
		]);
		expect(await hasValidInvite(fakeSql(false).sql, "token-1", "b@x.io")).toBe(
			false,
		);
		const malformed = fakeSql(true);
		expect(await hasValidInvite(malformed.sql, "x' OR 1=1", "b@x.io")).toBe(
			false,
		);
		expect(malformed.queries).toEqual([]);
	});

	test("refuses web sign-ups without a valid invite and lets in-process setup through", async () => {
		const none = fakeSql(false);
		const gate = createSignUpGate(none.sql, { OPALINE_SELF_HOSTED: "1" });
		expect(await refusal(gate({ email: "owner@x.io" }, undefined))).toBeNull();
		expect(none.queries).toEqual([]);

		const error = (await refusal(gate({ email: "a@x.io" }, signUp()))) as {
			status: string;
			body: { code: string; message: string };
		};
		expect(error.status).toBe("FORBIDDEN");
		expect(error.body.code).toBe(INVITE_REQUIRED);
		expect(error.body.message).toContain("invite-only");
		expect(none.queries).toEqual([]);

		expect(
			await refusal(
				gate({ email: "a@x.io" }, signUp({ cookie: "opaline_invite=stale" })),
			),
		).toMatchObject({ status: "FORBIDDEN" });

		const valid = createSignUpGate(fakeSql(true).sql, {});
		expect(
			await refusal(
				valid({ email: "a@x.io" }, signUp({ cookie: "opaline_invite=good" })),
			),
		).toBeNull();

		const open = fakeSql(false);
		expect(
			await refusal(
				createSignUpGate(open.sql, { OPALINE_OPEN_SIGNUP: "1" })(
					{ email: "a@x.io" },
					signUp(),
				),
			),
		).toBeNull();
		expect(open.queries).toEqual([]);
	});
});
