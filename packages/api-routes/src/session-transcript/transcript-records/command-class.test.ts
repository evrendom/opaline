import { describe, expect, test } from "bun:test";
import {
	classifyCommand,
	classifyScriptName,
	extractShellFileMutations,
	parseShellCommand,
	shellCommandSpans,
} from "./command-class.js";
import type { CommandClass } from "./types.js";

describe("classifyCommand", () => {
	const cases: readonly (readonly [string, CommandClass])[] = [
		["", ""],
		["ls -la", "other"],
		["bun test", "test"],
		["bun test src/foo.test.ts", "test"],
		["bun run test:integration", "test"],
		["bun run --cwd packages/ch-schema test", "test"],
		["pnpm --filter web test", "test"],
		["npm test", "test"],
		["npx vitest run", "test"],
		["bunx vitest --watch=false", "test"],
		["uv run pytest -x", "test"],
		["python -m pytest tests/", "test"],
		["go test ./...", "test"],
		["cargo test --workspace", "test"],
		["playwright test", "test"],
		["turbo run test --filter=api", "test"],
		["make test", "test"],
		["bun run verify", "other"],
		["tsc --noEmit", "typecheck"],
		["bun run check-types", "typecheck"],
		["cd apps/api && bunx tsc --noEmit -p .", "typecheck"],
		["cargo check", "typecheck"],
		["biome check .", "lint"],
		["bun run lint", "lint"],
		["eslint src", "lint"],
		["cargo clippy", "lint"],
		["ruff check .", "lint"],
		["bun run build", "build"],
		["npm run build -- --watch", "build"],
		["vite build", "build"],
		["cargo build --release", "build"],
		["docker build -t x .", "build"],
		["make", "build"],
		["bun run ch:migrate:f16", "migrate"],
		["drizzle-kit push", "migrate"],
		["prisma migrate dev", "migrate"],
		["bun install", "install"],
		["bun add zod", "install"],
		["npm ci", "install"],
		["pnpm install --frozen-lockfile", "install"],
		["pip install -r requirements.txt", "install"],
		["safe-install", "install"],
		["git status", "git"],
		["git commit -m 'fix tests' && git push", "git"],
		["gh pr create --draft", "git"],
		["FOO=1 bun test", "test"],
		["sudo bun install", "install"],
		["bun install && bun test", "test"],
		["bun run build && git add .", "build"],
		["bun test 2>&1 | tail -20", "test"],
		["cat <<'EOF'\nbun test\nEOF", "other"],
		["bun scripts/seed.ts", "other"],
		["echo 'bun test' > notes.txt", "other"],
	];

	for (const [command, expected] of cases) {
		test(`${JSON.stringify(command)} is ${JSON.stringify(expected)}`, () => {
			expect(classifyCommand(command)).toBe(expected);
		});
	}
});

describe("classifyScriptName", () => {
	test("matches whole words in package script names", () => {
		expect(classifyScriptName("test:integration")).toBe("test");
		expect(classifyScriptName("ci:test")).toBe("test");
		expect(classifyScriptName("check-types")).toBe("typecheck");
		expect(classifyScriptName("lint:fix")).toBe("lint");
		expect(classifyScriptName("build:site")).toBe("build");
		expect(classifyScriptName("ch:migrate:f16")).toBe("migrate");
		expect(classifyScriptName("contest")).toBe("other");
		expect(classifyScriptName("latest")).toBe("other");
	});
});

describe("extractShellFileMutations", () => {
	test("finds explicit redirects, tee, sed -i, mv, cp, rm, touch, and git restores", () => {
		expect(
			extractShellFileMutations(
				[
					"echo a > out.txt",
					"echo b >> log.txt",
					"echo c | tee -a tee.txt",
					"sed -i.bak 's/a/b/' src/a.ts src/b.ts",
					"sed -i '' -e 's/a/b/' src/c.ts",
					"mv src/old.ts src/new.ts",
					"cp src/a.ts src/copy.ts",
					"rm -rf build",
					"touch marker",
					"git checkout -- src/x.ts",
					"git restore src/y.ts",
					"git rm src/z.ts",
				].join("\n"),
			),
		).toEqual([
			{ basis: "direct", operation: "write", path: "out.txt" },
			{ basis: "direct", operation: "write", path: "log.txt" },
			{ basis: "direct", operation: "write", path: "tee.txt" },
			{ basis: "direct", operation: "edit", path: "src/a.ts" },
			{ basis: "direct", operation: "edit", path: "src/b.ts" },
			{ basis: "direct", operation: "edit", path: "src/c.ts" },
			{ basis: "direct", operation: "delete", path: "src/old.ts" },
			{ basis: "direct", operation: "write", path: "src/new.ts" },
			{ basis: "direct", operation: "write", path: "src/copy.ts" },
			{ basis: "direct", operation: "delete", path: "build" },
			{ basis: "direct", operation: "write", path: "marker" },
			{ basis: "direct", operation: "edit", path: "src/x.ts" },
			{ basis: "direct", operation: "edit", path: "src/y.ts" },
			{ basis: "direct", operation: "delete", path: "src/z.ts" },
		]);
	});

	test("ignores reads, descriptor duplication, /dev/null, temp files, and plain sed", () => {
		expect(
			extractShellFileMutations(
				[
					"cat src/a.ts",
					"sed -n '1,20p' src/a.ts",
					"bun test > /dev/null 2>&1",
					"bun test 2>&1 | tail",
					"echo x > /tmp/scratch.txt",
					"grep -rn 'a > b' src",
				].join("\n"),
			),
		).toEqual([]);
	});

	test("resolves relative paths after an absolute cd so temp directories stay excluded", () => {
		expect(extractShellFileMutations("cd /tmp/chq && echo x > q.sql")).toEqual(
			[],
		);
		expect(
			extractShellFileMutations("cd /repo/app && echo x > ../notes.md"),
		).toEqual([
			{ basis: "direct", operation: "write", path: "/repo/notes.md" },
		]);
	});

	test("here-document bodies are data, not commands", () => {
		expect(
			extractShellFileMutations(
				"cat > src/a.ts <<'EOF'\nrm -rf src\necho x > other.ts\nEOF\nbun test",
			),
		).toEqual([{ basis: "direct", operation: "write", path: "src/a.ts" }]);
	});
	test("conditional branches are inferred, not direct changes", () => {
		expect(extractShellFileMutations("true || rm src/keep.ts")).toEqual([
			{ basis: "conditional", operation: "delete", path: "src/keep.ts" },
		]);
		expect(
			extractShellFileMutations("test -f src/a.ts && rm src/a.ts; echo done"),
		).toEqual([
			{ basis: "conditional", operation: "delete", path: "src/a.ts" },
		]);
		expect(
			extractShellFileMutations("test -f a && touch b || touch c"),
		).toEqual([
			{ basis: "conditional", operation: "write", path: "b" },
			{ basis: "conditional", operation: "write", path: "c" },
		]);
		expect(extractShellFileMutations("if test -f a; then rm a; fi")).toEqual([
			{ basis: "conditional", operation: "delete", path: "a" },
		]);
	});

	test("everything inside an unsupported compound construct is inferred", () => {
		expect(
			extractShellFileMutations("if false; then :; rm src/keep.ts; fi"),
		).toEqual([
			{ basis: "conditional", operation: "delete", path: "src/keep.ts" },
		]);
		expect(
			extractShellFileMutations("false && (echo skipped; rm src/keep.ts)"),
		).toEqual([
			{ basis: "conditional", operation: "delete", path: "src/keep.ts" },
		]);
		expect(
			extractShellFileMutations("false && { echo skipped; rm src/a.ts; }"),
		).toEqual([
			{ basis: "conditional", operation: "delete", path: "src/a.ts" },
		]);
		expect(
			extractShellFileMutations(
				"for f in a b; do echo $f; rm src/loop.ts; done",
			),
		).toEqual([
			{ basis: "conditional", operation: "delete", path: "src/loop.ts" },
		]);
		expect(
			extractShellFileMutations(
				"case $x in a) rm src/case.ts ;; esac; touch after.txt",
			),
		).toEqual([
			{ basis: "conditional", operation: "delete", path: "src/case.ts" },
			{ basis: "direct", operation: "write", path: "after.txt" },
		]);
	});

	test("commands after a compound construct are direct again", () => {
		expect(
			extractShellFileMutations("if true; then :; fi\nrm src/after.ts"),
		).toEqual([{ basis: "direct", operation: "delete", path: "src/after.ts" }]);
		expect(
			extractShellFileMutations("(cd sub; rm a.ts); rm src/after.ts"),
		).toEqual([
			{ basis: "conditional", operation: "delete", path: "a.ts" },
			{ basis: "direct", operation: "delete", path: "src/after.ts" },
		]);
	});

	test.each([
		"function unused { :; rm src/keep.ts; }; echo ok",
		"function unused { rm src/keep.ts; }; echo ok",
		"function unused() { :; rm src/keep.ts; }; echo ok",
		"unused() { :; rm src/keep.ts; }; echo ok",
		"unused() { rm src/keep.ts; }; echo ok",
		"unused()\n{ :; rm src/keep.ts; }; echo ok",
		"unused()\n{ rm src/keep.ts; }; echo ok",
		"time if false; then :; rm src/keep.ts; fi",
		"time -p if false; then :; rm src/keep.ts; fi",
		"! if false; then :; rm src/keep.ts; fi",
		"! time if false; then :; rm src/keep.ts; fi",
	])("unexecuted bodies stay inferred: %s", (command) => {
		expect(extractShellFileMutations(`${command}; touch after.txt`)).toEqual([
			{ basis: "conditional", operation: "delete", path: "src/keep.ts" },
			{ basis: "direct", operation: "write", path: "after.txt" },
		]);
	});

	test("the first command of a list and a final all-and chain stay direct", () => {
		expect(extractShellFileMutations("rm src/a.ts || true")).toEqual([
			{ basis: "direct", operation: "delete", path: "src/a.ts" },
		]);
		expect(
			extractShellFileMutations("mkdir out && echo x > out/a.txt"),
		).toEqual([{ basis: "direct", operation: "write", path: "out/a.txt" }]);
		expect(
			extractShellFileMutations("echo x > a.txt & rm b.txt | cat"),
		).toEqual([
			{ basis: "direct", operation: "write", path: "a.txt" },
			{ basis: "direct", operation: "delete", path: "b.txt" },
		]);
	});

	test("an explicit mutation outranks a conditional duplicate of itself", () => {
		expect(extractShellFileMutations("true || rm a; rm a")).toEqual([
			{ basis: "direct", operation: "delete", path: "a" },
		]);
		expect(extractShellFileMutations("rm a; true || rm a")).toEqual([
			{ basis: "direct", operation: "delete", path: "a" },
		]);
	});

	test("index-only Git operations are not working-tree changes", () => {
		expect(
			extractShellFileMutations(
				[
					"git rm --cached src/keep.ts",
					"git restore --staged src/staged.ts",
					"git restore --staged --worktree src/both.ts",
					"git rm -n src/dry.ts",
					"git add src/added.ts",
				].join("\n"),
			),
		).toEqual([
			{ basis: "index", operation: "delete", path: "src/keep.ts" },
			{ basis: "index", operation: "edit", path: "src/staged.ts" },
			{ basis: "direct", operation: "edit", path: "src/both.ts" },
		]);
	});
});

describe("parseShellCommand", () => {
	test("splits on control operators and keeps quoted operators intact", () => {
		expect(
			parseShellCommand(`a && b || c; d | e\nf 'x && y' "p | q"`).map(
				(command) => command.words,
			),
		).toEqual([["a"], ["b"], ["c"], ["d"], ["e"], ["f", "x && y", "p | q"]]);
	});

	test("records the operator that joined each command", () => {
		expect(
			parseShellCommand("a && b || c; d | e & f\ng").map(
				(command) => command.connector,
			),
		).toEqual([null, "&&", "||", ";", "|", ";", ";"]);
		expect(
			parseShellCommand("a && (b)").map((command) => command.connector),
		).toEqual([null, "&&"]);
	});
});

describe("shellCommandSpans", () => {
	test("each command's place in the text, a here-document's body left out", () => {
		const command =
			"cd ~/a && grep -n x f.ts | head -3; python3 - <<'EOF'\nprint(1)\nEOF\n(cd b && ls)";
		expect(
			shellCommandSpans(command).map(({ end, start }) =>
				command.slice(start, end),
			),
		).toEqual([
			"cd ~/a",
			"grep -n x f.ts",
			"head -3",
			"python3 - <<'EOF'",
			"cd b",
			"ls",
		]);
		expect(shellCommandSpans(command)).toHaveLength(
			parseShellCommand(command).length,
		);
	});
});
