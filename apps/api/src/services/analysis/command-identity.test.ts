import { describe, expect, test } from "bun:test";
import * as identity from "@rudel/api-routes/command-identity";
import {
	commandColumnsSql,
	commandFamilies,
	commandFamiliesSql,
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

const FAMILY_CASES: readonly (readonly [string, readonly string[]])[] = [
	["bun run check-types", ["bun run check-types"]],
	[
		"cd apps/web && bun run check-types 2>&1 | tail -20",
		["bun run check-types"],
	],
	["bun run --cwd apps/web check-types", ["bun run check-types"]],
	[
		"bun run --cwd=apps/web check-types > /tmp/types.log 2>&1",
		["bun run check-types"],
	],
	["FOO=1 CI=true bun run check-types", ["bun run check-types"]],
	["export CI=1; bun run check-types", ["bun run check-types"]],
	[
		"bun run check-types && bun run build",
		["bun run check-types", "bun run build"],
	],
	[
		"bun run check-types; bun run lint || true",
		["bun run check-types", "bun run lint"],
	],
	["timeout 120 env DEBUG=1 bun test src/a.test.ts", ["bun test"]],
	["git -C ../other status --short", ["git status"]],
	["git status --short | head -45", ["git status"]],
	["git log --oneline | grep fix | head -5", ["git log"]],
	["ps aux | sort -nrk3 | xargs kill", ["ps"]],
	["git commit -m 'fix: a && b; c | d'", ["git commit"]],
	['echo "done" && npm test', ["npm test"]],
	["bunx biome check src/a.ts", ["bunx biome check"]],
	["npx tsc --noEmit -p .", ["npx tsc"]],
	["pnpm --filter @scope/web run build", ["pnpm run build"]],
	["gh pr view 12 --json state", ["gh pr view"]],
	["python3 -m pytest tests", ["python3 pytest"]],
	["node scripts/check.mjs --fix", ["node check.mjs"]],
	["node -e 'const a = 1; console.log(a)'", ["node"]],
	['node --input-type=module -e \'import { x } from "y"; const', ["node"]],
	["python3 - <<'PY'\nimport os\nfrom x import y\nPY", ["python3"]],
	["sed -n '1,200p' apps/web/src/a.ts", ["sed"]],
	["/usr/local/bin/rg -n foo apps", ["rg"]],
	[
		"(cd apps/web && bun run check-types) && git diff --check",
		["bun run check-types", "git diff"],
	],
	["cd apps/web", []],
	["for f in a b; do echo $f; done", []],
];

describe("command families", () => {
	test.each(FAMILY_CASES)("%p", (command, families) => {
		expect(commandFamilies(command)).toEqual([...families]);
	});

	test("the SQL is one Array(String) expression over the given column", () => {
		const sql = commandFamiliesSql("command_head");
		expect(sql).toStartWith("arrayDistinct(");
		expect(sql).toContain("splitByRegexp(");
		expect(sql.match(/command_head/g)?.length).toBe(1);
	});
});
