import { expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import { loggableError, SanitizedError } from "./errors.js";

test("only sanitized messages are logged; other errors give their class or code", () => {
	const quoted = "transcript: export API_KEY=sk-live-123";
	expect(
		loggableError(new SanitizedError("Convex queries:create failed (Error)")),
	).toBe("Convex queries:create failed (Error)");
	expect(loggableError(new Error(quoted))).toBe("Error");
	expect(loggableError(new TypeError(quoted))).toBe("TypeError");
	expect(loggableError(new ORPCError("BAD_REQUEST", { message: quoted }))).toBe(
		"ORPCError BAD_REQUEST",
	);
	expect(loggableError(quoted)).toBe("string");
});
