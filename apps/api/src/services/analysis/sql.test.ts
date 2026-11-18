import { expect, test } from "bun:test";
import {
	chunkByParamBytes,
	PARAM_BYTES_PER_STATEMENT,
	paramValueBytes,
} from "./sql.js";

/** The URL clickhouse-js builds for one array parameter (formatQueryParams, then URLSearchParams). */
function urlBytes(values: readonly string[]): number {
	const literal = values
		.map(
			(value) =>
				`'${value.replace(/[\t\n\r'\\]/gu, (char) => `\\${char === "\t" ? "t" : char === "\n" ? "n" : char === "\r" ? "r" : char}`)}'`,
		)
		.join(",");
	return new URLSearchParams([["param_ids", `[${literal}]`]]).toString().length;
}

test("parameter sizes count the client's escaping, not just URL encoding", () => {
	// Apostrophes are escaped (\') before URL encoding: six bytes each.
	const quoted = `${"'".repeat(196)}abcd`;
	expect(paramValueBytes(quoted)).toBeGreaterThanOrEqual(196 * 6);
	const ids = Array.from({ length: 2_000 }, () => quoted);
	const chunks = chunkByParamBytes(ids, (id) => [id]);
	expect(chunks.length).toBeGreaterThan(4);
	for (const chunk of chunks)
		expect(urlBytes(chunk)).toBeLessThanOrEqual(PARAM_BYTES_PER_STATEMENT + 64);
	// The estimate never undercounts what the client sends.
	for (const value of ["plain", "o'neil", "back\\slash", "tab\tline\n", "é"])
		expect(paramValueBytes(value)).toBeGreaterThanOrEqual(
			urlBytes([value]) - urlBytes([]),
		);
});
