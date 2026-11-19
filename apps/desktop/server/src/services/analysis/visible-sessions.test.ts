import { expect, test } from "bun:test";
import { buildVisibleSessionCountStatement } from "./visible-sessions.js";

const member = { userId: "user", role: "member", ownSessionsOnly: false };

test("a member counts every member's sessions in the workspace; a number only", () => {
	const statement = buildVisibleSessionCountStatement("org", member, 365);
	expect(statement.query).toContain("SELECT uniqExact(session_id) AS count");
	expect(statement.query).not.toContain("user_id");
	expect(statement.query_params).toEqual({ organizationId: "org", days: 365 });
});

test("with the own-sessions option on, a member counts only their own sessions and an admin the workspace", () => {
	const ownOnly = { ...member, ownSessionsOnly: true };
	const own = buildVisibleSessionCountStatement("org", ownOnly, 365);
	expect(own.query).toContain("AND user_id = {userId:String}");
	expect(own.query_params).toEqual({
		organizationId: "org",
		days: 365,
		userId: "user",
	});
	const admin = buildVisibleSessionCountStatement(
		"org",
		{ ...ownOnly, role: "admin" },
		365,
	);
	expect(admin.query).not.toContain("user_id");
	expect(admin.query_params).toEqual({ organizationId: "org", days: 365 });
});
