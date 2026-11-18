import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { ORPCError } from "@orpc/server";
import { requireSessionDetailOwnerAccess } from "./session-detail-access.js";

function captureExpectedError(action: () => unknown) {
	try {
		action();
	} catch (error) {
		return error;
	}

	throw new Error("Expected the access decision to reject the request");
}

const member = { userId: "member-1", role: "member", ownSessionsOnly: false };

describe("requireSessionDetailOwnerAccess", () => {
	test("does not reveal a session without a registered owner", () => {
		const error = captureExpectedError(() =>
			requireSessionDetailOwnerAccess(null, member),
		);

		assert(error instanceof ORPCError);
		expect(error.code).toBe("NOT_FOUND");
	});

	test("a member opens a teammate's session", () => {
		expect(requireSessionDetailOwnerAccess("owner-1", member)).toBe("owner-1");
	});

	describe("with the own-sessions option on", () => {
		const ownOnly = { ...member, ownSessionsOnly: true };

		test("rejects a member reading another member's session", () => {
			const error = captureExpectedError(() =>
				requireSessionDetailOwnerAccess("owner-1", ownOnly),
			);

			assert(error instanceof ORPCError);
			expect(error.code).toBe("FORBIDDEN");
			expect(error.message).toBe("You can only view your own sessions");
		});

		test("returns the registered owner for the owner and organization admins", () => {
			expect(
				requireSessionDetailOwnerAccess("owner-1", {
					...ownOnly,
					userId: "owner-1",
				}),
			).toBe("owner-1");
			for (const role of ["admin", "owner"])
				expect(
					requireSessionDetailOwnerAccess("owner-1", {
						...ownOnly,
						userId: "admin-1",
						role,
					}),
				).toBe("owner-1");
		});
	});
});
