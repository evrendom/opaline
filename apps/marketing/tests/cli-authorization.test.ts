import { expect, test } from "bun:test";
import {
	cliAuthorizationUrl,
	readCliAuthorization,
	readStoredCliAuthorization,
} from "../../web/src/features/cli-onboarding/cli-authorization";

const authorization = {
	id: "4f13c890-4a7e-4bc2-8c26-f2e8be5d0048",
	userCode: "ABCD-1234",
};

test("paired login returns to welcome with the same authorization after OAuth", () => {
	const url = new URL(cliAuthorizationUrl(authorization, "https://opaline.so"));
	expect(url.origin).toBe("https://opaline.so");
	expect(url.pathname).toBe("/welcome");
	expect(url.hash).toBe("");
	expect(readCliAuthorization(url.search)).toEqual(authorization);
});

test("incomplete or malformed login links never become authorizations", () => {
	for (const search of [
		"?user_code=ABCD-1234",
		`?connect=${authorization.id}`,
		"?connect=not-an-id&user_code=ABCD-1234",
		`?connect=${authorization.id}&user_code=%1B%5B2J`,
	])
		expect(readCliAuthorization(search)).toBeNull();
});

test("tab synchronization validates stored authorization data", () => {
	expect(readStoredCliAuthorization(JSON.stringify(authorization))).toEqual(
		authorization,
	);
	for (const value of [
		null,
		"{",
		"null",
		'"text"',
		JSON.stringify({ ...authorization, userCode: [] }),
	])
		expect(readStoredCliAuthorization(value)).toBeNull();
});
