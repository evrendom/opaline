import { describe, expect, test } from "bun:test";
import { parseConversations } from "../index.js";

describe("conversation schema", () => {
	test("keeps user entries whose tool results omit image source or structured value", () => {
		const line = JSON.stringify({
			type: "user",
			uuid: "user-1",
			parentUuid: null,
			sessionId: "session-1",
			timestamp: "2026-10-02T10:00:00.000Z",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: [{ type: "image" }, { type: "structured" }],
					},
				],
			},
		});

		expect(parseConversations(line)).toHaveLength(1);
	});
});
