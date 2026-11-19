import { describe, expect, test } from "bun:test";
import {
	createUnsubscribeToken,
	readUnsubscribeToken,
} from "./unsubscribe-token.js";

const SECRET = "usage-digest-test-secret-at-least-32-chars";
const target = {
	kind: "weekly" as const,
	userId: "user-1",
	organizationId: "org-1",
};

describe("usage digest unsubscribe tokens", () => {
	test("name the member, workspace and digest they were signed for", () => {
		expect(
			readUnsubscribeToken(SECRET, createUnsubscribeToken(SECRET, target)),
		).toEqual(target);
	});

	test("are refused when changed or signed with another secret", () => {
		const token = createUnsubscribeToken(SECRET, target);
		const [, signature] = token.split(".");
		const forged = `${Buffer.from(JSON.stringify(["weekly", "user-2", "org-1"])).toString("base64url")}.${signature}`;
		expect(readUnsubscribeToken(SECRET, forged)).toBeNull();
		expect(readUnsubscribeToken(`${SECRET}x`, token)).toBeNull();
		expect(readUnsubscribeToken(SECRET, `${token}.extra`)).toBeNull();
		expect(readUnsubscribeToken(SECRET, "")).toBeNull();
	});
});
