import { describe, expect, test } from "bun:test";
import * as identity from "@rudel/api-routes/command-identity";
import {
	commandColumnsSql,
	lit,
	NORMALIZATION_RULES,
} from "./command-identity.js";

const CLICKHOUSE_ESCAPES: Readonly<Record<string, string>> = {
	"0": "\0",
	a: "\x07",
	b: "\b",
	e: "\x1b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
};

function readClickHouseString(literal: string): string {
	expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true);
	const body = literal.slice(1, -1);
	let value = "";
	for (let index = 0; index < body.length; index++) {
		const char = body[index] as string;
		if (char === "'") throw new Error(`unescaped quote at ${index}`);
		if (char !== "\\") {
			value += char;
			continue;
		}
		const next = body[++index] ?? "";
		if (next === "x") {
			value += String.fromCharCode(
				Number.parseInt(body.slice(index + 1, index + 3), 16),
			);
			index += 2;
		} else value += CLICKHOUSE_ESCAPES[next] ?? next;
	}
	return value;
}

const SHARED_PATTERNS = Object.entries(identity).flatMap(([name, value]) =>
	typeof value === "string"
		? [[name, value] as const]
		: Array.isArray(value)
			? value
					.filter((item): item is string => typeof item === "string")
					.map((item, index) => [`${name}[${index}]`, item] as const)
			: [],
);

describe("command identity patterns embedded in ClickHouse SQL", () => {
	test("a literal reads back as the text it was made from", () => {
		expect(lit(String.raw`a'b\c`)).toBe(String.raw`'a\'b\\c'`);
		for (const text of ["", "'", "\\", "\\'", "\\\\'", String.raw`\s\x60\n`])
			expect(readClickHouseString(lit(text))).toBe(text);
	});

	test.each(SHARED_PATTERNS)("%s reads back unchanged", (_name, pattern) => {
		expect(readClickHouseString(lit(pattern))).toBe(pattern);
	});

	test("every normalization rule reads back unchanged", () => {
		for (const { pattern, replacement } of NORMALIZATION_RULES) {
			expect(readClickHouseString(lit(pattern))).toBe(pattern);
			expect(readClickHouseString(lit(replacement))).toBe(replacement);
		}
	});

	test("the columns read the setup and program patterns the JavaScript reads", () => {
		const sql = commandColumnsSql();
		expect(sql).toContain(lit(identity.SETUP));
		expect(sql).toContain(lit(identity.PROGRAM_WORD));
	});
});
