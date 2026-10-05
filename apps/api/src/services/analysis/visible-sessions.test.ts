import { expect, test } from "bun:test";
import { buildVisibleSessionCountStatement } from "./visible-sessions.js";

test("a member counts only their own sessions; an admin counts the workspace; both return a number only", () => {
	const member = buildVisibleSessionCountStatement("org", "user", 365);
	expect(member.query).toContain("AND user_id = {userId:String}");
	expect(member.query).toContain("SELECT uniqExact(session_id) AS count");
	expect(member.query_params).toEqual({
		organizationId: "org",
		days: 365,
		userId: "user",
	});
	const admin = buildVisibleSessionCountStatement("org", null, 365);
	expect(admin.query).not.toContain("user_id");
	expect(admin.query_params).toEqual({ organizationId: "org", days: 365 });
});
