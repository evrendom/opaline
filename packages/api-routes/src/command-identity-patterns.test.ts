import { describe, expect, test } from "bun:test";
import * as identity from "./command-identity.js";

const PATTERNS: readonly (readonly [string, string])[] = Object.entries(
	identity,
).flatMap(([name, value]): (readonly [string, string])[] => {
	if (typeof value === "string") return [[name, value]];
	if (Array.isArray(value) && value.every((item) => typeof item === "string"))
		return value.map((item, index) => [`${name}[${index}]`, item] as const);
	return [];
});

const GROUP_SYNTAX: readonly (readonly [string, string])[] = [
	["=", "lookahead"],
	["!", "negative lookahead"],
	["<=", "lookbehind"],
	["<!", "negative lookbehind"],
	[">", "atomic group"],
	["|", "branch reset"],
	["#", "comment group"],
	["(", "conditional"],
	["R", "recursion"],
	["&", "subroutine"],
	["P=", "named backreference"],
	["P>", "subroutine"],
	["'", "named group"],
	["<", "named group"],
];

const ESCAPES: Readonly<Record<string, string>> = {
	G: "\\G anchor",
	K: "\\K reset",
	R: "\\R line break",
	X: "\\X cluster",
	Z: "\\Z anchor",
	c: "\\c control escape",
	g: "\\g reference",
	k: "named backreference",
	u: "\\u escape",
};

function re2Problems(pattern: string): string[] {
	const problems: string[] = [];
	let inClass = false;
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index];
		const next = pattern[index + 1] ?? "";
		if (char === "\\") {
			if (/[1-9]/u.test(next)) problems.push(`backreference \\${next}`);
			else if (ESCAPES[next]) problems.push(ESCAPES[next]);
			index++;
			continue;
		}
		if (inClass) {
			if (char === "]") inClass = false;
			continue;
		}
		if (char === "[") {
			inClass = true;
			if (pattern[index + 1] === "^") index++;
			if (pattern[index + 1] === "]") index++;
			continue;
		}
		if (char === "(" && next === "?") {
			const rest = pattern.slice(index + 2);
			const found = GROUP_SYNTAX.find(([prefix]) => rest.startsWith(prefix));
			if (found) problems.push(found[1]);
			continue;
		}
		if ("*+?}".includes(char ?? "") && next === "+")
			problems.push("possessive quantifier");
	}
	return problems;
}

const FIXTURES: Readonly<
	Record<string, readonly (readonly [string, string | null])[]>
> = {
	ASSIGNMENT: [
		["A=1 make", "A=1"],
		['B="x y" run', 'B="x y"'],
		["C=$(pwd)/x go", "C=$(pwd)/x"],
		["make all", null],
	],
	DOUBLE_QUOTED: [
		['say "hi $(whoami) \\"q\\"" rest', '"hi $(whoami) \\"q\\""'],
		['"$HOME/x"', '"$HOME/x"'],
		["'single'", null],
	],
	PROGRAM_WORD: [
		["git status", "git"],
		["$(which node) x", "$(which node)"],
		["./run.sh; y", "./run.sh"],
		["(sub)", null],
	],
	SEPARATOR: [
		["a && b", "&&"],
		["a || b", "||"],
		["a; b", ";"],
		["a\nb", "\n"],
		["a | b", null],
	],
	SETUP: [
		["cd ~/repo && export A=1; git push", "cd ~/repo && export A=1; "],
		["# note\nnpm test", "# note\n"],
		["FOO=1 BAR=2 && make", "FOO=1 BAR=2 && "],
		["REDACTED; ls", "REDACTED; "],
		["git status", ""],
	],
	SHELL_WRAPPER: [
		["bash -lc 'gh run'", "bash -lc "],
		["/bin/zsh -c 'x'", "/bin/zsh -c "],
		["sh -e -c x", "sh -e -c "],
		["bash script.sh", null],
	],
	SUBSTITUTION: [
		["echo $(git rev-parse HEAD) x", "$(git rev-parse HEAD)"],
		["a `date` b", "`date`"],
		['$(echo "(x)")', '$(echo "(x)")'],
		["no subst", null],
	],
	VALUE_FLAGS: [
		["git -C dir status", "-C"],
		["pnpm --filter web test", "--filter"],
		["ls -la", null],
	],
	WORDS: [
		["git status; ls", "git status"],
		["echo 'a;b' && x", "echo 'a;b' "],
		['cd "$DIR" | y', 'cd "$DIR" '],
	],
	WRAPPER: [
		["sudo -u me make", "sudo -u me"],
		["npx -p pkg tsc", "npx -p pkg"],
		["make all", null],
	],
	"WRAPPERS[0]": [["sudo -u me make", "sudo -u me"]],
	"WRAPPERS[1]": [["doas x", "doas"]],
	"WRAPPERS[2]": [["command x", "command"]],
	"WRAPPERS[3]": [["exec x", "exec"]],
	"WRAPPERS[4]": [["nohup x", "nohup"]],
	"WRAPPERS[5]": [["caffeinate -i x", "caffeinate -i"]],
	"WRAPPERS[6]": [["time -p x", "time -p"]],
	"WRAPPERS[7]": [["nice -n 10 x", "nice -n 10"]],
	"WRAPPERS[8]": [["stdbuf -oL x", "stdbuf -oL"]],
	"WRAPPERS[9]": [["unbuffer x", "unbuffer"]],
	"WRAPPERS[10]": [["env -u A x", "env -u A"]],
	"WRAPPERS[11]": [["timeout 30s x", "timeout 30s"]],
	"WRAPPERS[12]": [["rtk proxy x", "rtk proxy"]],
	"WRAPPERS[13]": [["npx -p pkg tsc", "npx -p pkg"]],
	"WRAPPERS[14]": [["pnpm exec -- tsc", "pnpm exec --"]],
	"WRAPPERS[15]": [["bun x tsc", "bun x"]],
	"WRAPPERS[16]": [["uv run --with a pytest", "uv run --with a"]],
	"WRAPPERS[17]": [["conda run -n env py", "conda run -n env"]],
	"WRAPPERS[18]": [["mise exec node@20 -- node", "mise exec node@20 --"]],
};

describe("command identity patterns run in ClickHouse's RE2 and in JavaScript", () => {
	test("the check finds what RE2 cannot run", () => {
		for (const [pattern, problem] of [
			["a(?=b)", "lookahead"],
			["a(?!b)", "negative lookahead"],
			["(?<=a)b", "lookbehind"],
			["(?<!a)b", "negative lookbehind"],
			["(a)\\1", "backreference \\1"],
			["(?<name>a)", "named group"],
			["(?<name>a)\\k<name>", "named backreference"],
			["(?>a)", "atomic group"],
			["a*+", "possessive quantifier"],
			["a{2}+", "possessive quantifier"],
			["\\u0060", "\\u escape"],
		] as const)
			expect(re2Problems(pattern)).toContain(problem);
		expect(re2Problems("[(?=]\\(?=a\\)[\\]]*?")).toEqual([]);
	});

	test.each(PATTERNS)("%s has nothing RE2 lacks", (_name, pattern) => {
		expect(re2Problems(pattern)).toEqual([]);
	});

	test.each(PATTERNS)("%s compiles in JavaScript", (_name, pattern) => {
		expect(() => new RegExp(pattern)).not.toThrow();
		expect(() => new RegExp(pattern, "u")).not.toThrow();
	});

	test("every pattern has fixtures", () => {
		expect(Object.keys(FIXTURES).sort()).toEqual(
			PATTERNS.map(([name]) => name).sort(),
		);
	});

	test.each(PATTERNS)("%s matches its fixtures", (name, pattern) => {
		const fixtures = FIXTURES[name] ?? [];
		expect(fixtures.length).toBeGreaterThan(0);
		for (const [input, match] of fixtures) {
			const found = new RegExp(pattern, "u").exec(input);
			expect([input, found ? (found[1] ?? found[0]) : null]).toEqual([
				input,
				match,
			]);
		}
	});
});
