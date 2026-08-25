import { describe, expect, test } from "bun:test";
import { LEARNING_CONTENT_MAX_CODE_UNITS } from "@rudel/api-routes";
import { getClickhouse } from "../clickhouse.js";
import { clampLearningContent } from "../services/learnings.service.js";

describe("learning content ClickHouse UTF-8 boundary", () => {
	test("preserves a three-byte code point across the former 5,000-byte boundary", async () => {
		const prefix = "a".repeat(LEARNING_CONTENT_MAX_CODE_UNITS - 1);
		const [row] = await getClickhouse().query<{ content: string }>({
			query: `
				SELECT substringUTF8(
					{content:String},
					1,
					{limit:UInt32}
				) AS content
			`,
			query_params: {
				content: `${prefix}€tail`,
				limit: LEARNING_CONTENT_MAX_CODE_UNITS,
			},
		});

		expect(clampLearningContent(row?.content ?? "")).toBe(`${prefix}€`);
	}, 30_000);
});
