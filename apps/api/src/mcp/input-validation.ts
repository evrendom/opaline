import { ORPCError } from "@orpc/server";
import type { z } from "zod";

export function parseMcpInput<T>(
	schema: z.ZodType<T, unknown>,
	input: unknown,
): T {
	const result = schema.safeParse(input);
	if (result.success) return result.data;
	const issues = result.error.issues.map((issue) => ({
		path: issue.path,
		message: issue.message,
		code: issue.code,
	}));
	throw new ORPCError("BAD_REQUEST", {
		message: issues
			.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
			.join("; "),
		data: { issues },
	});
}
