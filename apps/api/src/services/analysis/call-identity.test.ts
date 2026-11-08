import { describe, expect, test } from "bun:test";
import { commandIdentityOf } from "./call-identity.js";

const PACKAGE_RUNNER = ["n", "px"].join("");

const SQL_VALUES: readonly (readonly [
	string,
	string,
	string | null,
	string | null,
	readonly string[],
	readonly string[],
	string,
	string | null,
])[] = [
	[
		"command",
		"cd ~/repo && bun test x.test.ts && bun run check-types 2>&1 | tail -3",
		"bun",
		"bun test",
		["bun", "tail"],
		["bun test", "bun run", "tail"],
		"3712742105824885920",
		null,
	],
	[
		"command",
		"git add -A; git commit -qm 'a && b' && git push -q origin HEAD",
		"git",
		"git add",
		["git"],
		["git add", "git commit", "git push"],
		"16434526428165069857",
		null,
	],
	[
		"command",
		"echo == types; FOO=1 timeout 60 uv run pytest -q | grep error",
		"pytest",
		"pytest",
		["pytest", "grep"],
		["pytest", "grep error"],
		"4434978983955852123",
		null,
	],
	[
		"command",
		"bash -lc 'gh run view 42 --log'",
		"gh",
		"gh run",
		["gh"],
		["gh run"],
		"16931280911575016031",
		null,
	],
	[
		"command",
		"python3 - <<'EOF'\nimport os\nprint(os.getcwd())\nEOF",
		"python3",
		"python3",
		["python3"],
		["python3"],
		"1619278375763366699",
		null,
	],
	[
		"command",
		"cat /Users/alice/work/app/src/index.ts | head -20",
		"cat",
		"cat",
		["cat", "head"],
		["cat", "head"],
		"14050966065280626662",
		null,
	],
	[
		"command",
		"export A=1; sudo -E make build",
		"make",
		"make build",
		["make"],
		["make build"],
		"7138324871491252857",
		null,
	],
	[
		"command",
		"git -C ../other status",
		"git",
		"git status",
		["git"],
		["git status"],
		"3793138605218711241",
		null,
	],
	[
		"command",
		"for f in a b c; do echo $f; done && rg -n 'TODO' src/ /tmp/abc12345/out.log 2026-11-07T10:00:00Z 0123abcd",
		"for",
		"for f",
		["rg"],
		["rg"],
		"11156006209455478777",
		"4227492497",
	],
	[
		"command",
		`${PACKAGE_RUNNER} tsc --noEmit -p apps/web && bun x biome check --write apps/web/src/a.tsx apps/web/src/b.tsx apps/web/src/c.tsx apps/web/src/d.tsx apps/web/src/e.tsx apps/web/src/f.tsx`,
		"tsc",
		"tsc",
		["tsc", "biome"],
		["tsc", "biome check"],
		"16228910004305681027",
		"3490899986",
	],
	[
		"script",
		"const r = await tools.exec_command({cmd: 'ls -la'}); const s = await tools.exec_command({cmd: 'pwd'}); text(r.output + s.output)",
		null,
		null,
		[],
		[],
		"4713017559517435369",
		"2104079268",
	],
];

describe("command identity at build time", () => {
	test.each(
		SQL_VALUES,
	)("%s %j is what the SQL definition computes", (from, text, argv0, prefix, programs, prefixes, fingerprint, simhash) => {
		const identity = commandIdentityOf(from, text);
		expect({
			...identity,
			simhash: identity.simhash === null ? null : String(identity.simhash),
		}).toEqual({
			argv0,
			prefix,
			programs: [...programs],
			prefixes: [...prefixes],
			fingerprint,
			simhash,
		});
	});

	test("a call without a whole command has no identity", () => {
		const none = {
			argv0: null,
			prefix: null,
			fingerprint: null,
			simhash: null,
			programs: [],
			prefixes: [],
		};
		expect(commandIdentityOf("command", null)).toEqual(none);
		expect(commandIdentityOf("", "ls")).toEqual(none);
	});
});
