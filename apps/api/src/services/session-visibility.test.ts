import { describe, expect, test } from "bun:test";
import {
	mayReadSession,
	readableSessionOwner,
	type SessionReader,
} from "./session-visibility.js";

const reader = (
	role: string,
	ownSessionsOnly: boolean,
	userId = "me",
): SessionReader => ({ userId, role, ownSessionsOnly });

describe("every member reads every session (own-sessions option off)", () => {
	test("a member reads a teammate's session and their own", () => {
		expect(mayReadSession(reader("member", false), "teammate")).toBe(true);
		expect(mayReadSession(reader("member", false), "me")).toBe(true);
	});

	test("members, admins and owners all read every member's sessions", () => {
		for (const role of ["member", "admin", "owner"])
			expect(readableSessionOwner(reader(role, false))).toBeNull();
	});
});

describe("own sessions only, admins all (own-sessions option on)", () => {
	test("a member reads only their own sessions", () => {
		expect(mayReadSession(reader("member", true), "teammate")).toBe(false);
		expect(mayReadSession(reader("member", true), "me")).toBe(true);
		expect(readableSessionOwner(reader("member", true))).toBe("me");
	});

	test("admins and owners read every member's sessions", () => {
		for (const role of ["admin", "owner"]) {
			expect(mayReadSession(reader(role, true), "teammate")).toBe(true);
			expect(readableSessionOwner(reader(role, true))).toBeNull();
		}
	});

	test("an unknown role reads like a member", () => {
		expect(mayReadSession(reader("guest", true), "teammate")).toBe(false);
	});
});
