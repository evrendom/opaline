import { describe, expect, test } from "bun:test";
import {
	alternativesIn,
	layoutShellCommand,
	leadingSpaces,
	orSyntax,
	quoteMarks,
	shortFolder,
	stageSpans,
	substitutionIn,
	tokenColor,
	wordsOf,
} from "./session-reader-shell-layout";

describe("layoutShellCommand", () => {
	test("a long pipeline, one stage per line", () => {
		expect(
			layoutShellCommand(
				'grep -n "^const has\\|^function values\\|^export type RuleContext" -A3 explain-rules.ts | head -30',
			),
		).toBe(
			'grep -n "^const has\\|^function values\\|^export type RuleContext" -A3 explain-rules.ts\n| head -30',
		);
	});

	test("joins and statements: && and || start a line, ; ends one", () => {
		expect(
			layoutShellCommand(
				"bun run check-types 2>&1 | tail -5 && bun test ./src/a.test.ts || echo failed; git status --short",
			),
		).toBe(
			"bun run check-types 2>&1\n| tail -5\n&& bun test ./src/a.test.ts\n|| echo failed\ngit status --short",
		);
	});

	test("never inside quotes, a substitution or a group", () => {
		const command =
			'id=$(gh run list --limit 1 | head -1); echo "a | b && c" | grep -q "a"';
		expect(layoutShellCommand(command)).toBe(
			'id=$(gh run list --limit 1 | head -1)\necho "a | b && c"\n| grep -q "a"',
		);
	});

	test("a short command, a multi-line one and a here-document as written", () => {
		expect(layoutShellCommand("ls | head")).toBe("ls | head");
		const multi =
			"set -a\nsource ~/.env | tail -1 && echo loaded and done here ok";
		expect(layoutShellCommand(multi)).toBe(multi);
		const doc =
			"python3 - <<'EOF' | tail -3\nprint(1)\nEOF && echo done with the script now";
		expect(layoutShellCommand(doc)).toBe(doc);
	});
});

describe("shortFolder", () => {
	test("a project under home: its name and the folder it ran in", () => {
		expect(
			shortFolder(
				"~/coding-projects/athena-compass-waterfall/packages/api-routes/src/command-glossary",
			),
		).toBe("athena-compass-waterfall · …/command-glossary");
		expect(shortFolder("/Users/evren/coding-projects/athena/apps/web")).toBe(
			"athena · …/web",
		);
		expect(shortFolder("~/coding-projects/athena/apps")).toBe("athena · apps");
		expect(shortFolder("~/coding-projects/athena")).toBe("athena");
	});

	test("elsewhere, short as is, long by its last two folders", () => {
		expect(shortFolder("/tmp/sf-work")).toBe("/tmp/sf-work");
		expect(shortFolder("/private/tmp/demo/tools/rec")).toBe("…/tools/rec");
	});
});

describe("tokenColor", () => {
	const lines = [
		[
			{ color: "#bun", content: "bun" },
			{ color: "#plain", content: " " },
			{ color: "#arg", content: "run" },
			{ color: "#plain", content: " " },
			{ color: "#arg", content: "drizzle:generate" },
			{ color: "#flag", content: " --name" },
			{ color: "#plain", content: " " },
			{ color: "#str", content: '"' },
			{ color: "#str", content: "MEMBER\\|Avatar" },
			{ color: "#str", content: '"' },
			{ color: "#arg", content: " tools/run-bun-tests.ts" },
		],
	];

	test("the token that is the word, else the one holding it, else the one it starts with", () => {
		expect(tokenColor(lines, "tools/run-bun-tests.ts")).toBe("#arg");
		expect(tokenColor(lines, "Avatar")).toBe("#str");
		expect(tokenColor(lines, "MEMBER (at line start)")).toBe("#str");
		expect(tokenColor(lines, "drizzle:generate")).toBe("#arg");
	});

	test("a word split across tokens takes the color of most of it", () => {
		const glob = [
			[
				{ color: "#flag", content: "--include=" },
				{ color: "#plain", content: "*" },
				{ color: "#flag", content: ".tsx" },
			],
		];
		expect(tokenColor(glob, "*.tsx")).toBe("#flag");
	});

	test("nothing for a word the command doesn't hold, or before highlighting", () => {
		expect(tokenColor(lines, "a.tsx")).toBeUndefined();
		expect(tokenColor(undefined, "bun")).toBeUndefined();
		expect(tokenColor(lines, "x")).toBeUndefined();
		expect(tokenColor(lines, "drizzle:generate --name x")).toBeUndefined();
	});
});

describe("stageSpans and wordsOf", () => {
	const line =
		'timeout 300 bun run check-types 2>&1 | grep "error TS" | head -5';

	test("each stage's span, the first from the start and the last to the end", () => {
		const spans = stageSpans(line, [
			"timeout 300 bun run check-types 2>&1",
			'grep "error TS"',
			"head -5",
		]);
		expect(spans?.map(({ end, start }) => line.slice(start, end))).toEqual([
			"timeout 300 bun run check-types 2>&1",
			'grep "error TS"',
			"head -5",
		]);
		const capture = "id=$(gh run list | head -1)";
		expect(
			stageSpans(capture, ["gh run list", "head -1"])?.map(({ end, start }) =>
				capture.slice(start, end),
			),
		).toEqual(["id=$(gh run list", "head -1)"]);
		expect(stageSpans(line, ["nope"])).toBeNull();
	});

	test("words of a span, a color run each", () => {
		const text = "timeout 300 bun x";
		const words = wordsOf(
			text,
			[
				[
					{ color: "#a", content: "timeout" },
					{ color: "#b", content: " 300 " },
					{ color: "#a", content: "bun" },
					{ color: "#c", content: " x" },
				],
			],
			{ end: text.length, start: 0 },
		);
		expect(words).toEqual([
			[{ color: "#a", text: "timeout" }],
			[{ color: "#b", text: "300" }],
			[{ color: "#a", text: "bun" }],
			[{ color: "#c", text: "x" }],
		]);
	});
});

describe("alternativesIn", () => {
	const line =
		'grep -n "renderer.setPixelRatio\\|  const run = () => {" necklace.ts';
	const whole = { end: line.length, start: 0 };

	test("each alternative of a quoted \\| pattern, its indentation kept", () => {
		const [found] = alternativesIn(line, whole);
		expect(found && line.slice(found.quoted.start, found.quoted.end)).toBe(
			'"renderer.setPixelRatio\\|  const run = () => {"',
		);
		const alternatives =
			found?.alternatives.map(({ end, start }) => line.slice(start, end)) ?? [];
		expect(alternatives).toEqual([
			"renderer.setPixelRatio",
			"  const run = () => {",
		]);
		expect(leadingSpaces(line, found?.alternatives[1] ?? whole)).toBe(2);
	});

	test("a quoted pattern without \\| isn't one", () => {
		expect(alternativesIn('grep "error TS" a.log', whole)).toEqual([]);
		expect(alternativesIn("echo 'a | b'", whole)).toEqual([]);
	});
});

describe("extended grep's |", () => {
	const of = (line: string) => {
		const whole = { end: line.length, start: 0 };
		return alternativesIn(line, whole, orSyntax(line, whole)).map((found) =>
			found.alternatives.map(({ end, start }) => line.slice(start, end)),
		);
	};

	test("grep -E, -iE, egrep and rg split at a bare |", () => {
		expect(of('tail -5 a.log | grep -iE "optimi|504|error"')).toEqual([
			["optimi", "504", "error"],
		]);
		expect(of("egrep 'a|b' x")).toEqual([["a", "b"]]);
		expect(of('rg "fixup|wip"')).toEqual([["fixup", "wip"]]);
	});

	test("not inside a group or a [class], and not for plain grep or echo", () => {
		expect(of('grep -E "ingest/(init|commit)|done"')).toEqual([
			["ingest/(init|commit)", "done"],
		]);
		expect(of('grep -E "[|]x|y"')).toEqual([["[|]x", "y"]]);
		expect(of('grep "a|b" x')).toEqual([]);
		expect(of('echo "a | b"')).toEqual([]);
	});
});

describe("quoteMarks", () => {
	test("where each quoted text opens and closes, escaped quotes skipped", () => {
		const line = `git commit -m "say \\"hi\\"" && grep 'a b' x`;
		expect([...quoteMarks(line)].map(([at, mark]) => [line[at], mark])).toEqual(
			[
				['"', "open"],
				['"', "close"],
				["'", "open"],
				["'", "close"],
			],
		);
		expect(quoteMarks("ls -la").size).toBe(0);
	});
});

describe("substitutionIn", () => {
	const parts = (line: string) => {
		const found = substitutionIn(line, { end: line.length, start: 0 });
		return (
			found && {
				find: line.slice(found.find.start, found.find.end),
				flags: line.slice(found.flags.start, found.flags.end),
				replace: line.slice(found.replace.start, found.replace.end),
			}
		);
	};

	test("what it finds, what it puts instead, its flags", () => {
		expect(
			parts("sed -i '' 's/await wait(8000)\\n  const t/X/' pix.mjs"),
		).toEqual({
			find: "await wait(8000)\\n  const t",
			flags: "",
			replace: "X",
		});
		expect(parts('sed "s#a/b#c#g" x')).toEqual({
			find: "a/b",
			flags: "g",
			replace: "c",
		});
	});

	test("not two substitutions, not for another program", () => {
		expect(parts("sed 's/a/b/;s/c/d/' x")).toBeNull();
		expect(parts("echo 's/a/b/'")).toBeNull();
	});
});
