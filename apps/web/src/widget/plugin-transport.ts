import type { ClientLink } from "@orpc/client";
import { ORPCError } from "@orpc/client";
import { pluginToolName } from "@rudel/api-routes";

export function readToolResult(result: unknown) {
	if (!result || typeof result !== "object" || !("structuredContent" in result))
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Invalid host tool response.",
		});
	if ("isError" in result && result.isError) {
		const content = result.structuredContent;
		const error =
			content && typeof content === "object" && "error" in content
				? content.error
				: null;
		if (!error || typeof error !== "object")
			throw new ORPCError("INTERNAL_SERVER_ERROR");
		throw new ORPCError(
			"code" in error && typeof error.code === "string"
				? error.code
				: "INTERNAL_SERVER_ERROR",
			{
				message:
					"message" in error && typeof error.message === "string"
						? error.message
						: "Opaline could not load this.",
				status:
					"status" in error && typeof error.status === "number"
						? error.status
						: 500,
				data: "data" in error ? error.data : undefined,
			},
		);
	}
	return result.structuredContent;
}

export function pluginToolCall(
	path: readonly string[],
	input: unknown,
	workspace: string,
): { name: string; arguments: Record<string, unknown> } {
	// Only the procedures the server serves as app-only tools, by their names.
	const name = path.every((part) => /^[a-zA-Z][a-zA-Z0-9]*$/u.test(part))
		? pluginToolName(path.join("."))
		: undefined;
	if (!name) throw new ORPCError("BAD_REQUEST");
	if (
		input !== undefined &&
		(input === null || typeof input !== "object" || Array.isArray(input))
	)
		throw new ORPCError("BAD_REQUEST");
	return { name, arguments: { ...input, workspace } };
}

export function createPluginLink(
	callTool: (
		name: string,
		args: object,
		signal?: AbortSignal,
	) => Promise<unknown>,
	workspace: () => string,
): ClientLink<Record<never, never>> {
	return {
		async call(path, input, options) {
			const tool = pluginToolCall(path, input, workspace());
			const payload = await callTool(tool.name, tool.arguments, options.signal);
			if (!payload || typeof payload !== "object" || !("result" in payload))
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Invalid plugin procedure response.",
				});
			return payload.result;
		},
	};
}
