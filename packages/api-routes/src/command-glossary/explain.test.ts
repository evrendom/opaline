import { describe, expect, test } from "bun:test";
import { type ExplainedStep, explainCommand, type Segment } from "./explain.js";
import { FIG_SPECS } from "./generated/fig/index.js";
import { parseArguments } from "./parse-arguments.js";

const render = (segments: Segment[]) =>
	segments
		.map((segment) =>
			"text" in segment
				? segment.text
				: "file" in segment
					? `[${segment.file.split("/").at(-1)}]`
					: "term" in segment
						? `"${segment.term}"`
						: `\`${segment.code}\``,
		)
		.join("");

const lines = (steps: ExplainedStep[]) =>
	steps.map(
		(step) =>
			`${step.connector ? `${step.connector}: ` : ""}${step.quiet ? "· " : ""}${step.title} — ${render(step.sentence)}`,
	);

describe("Fig's argument parser", () => {
	test("subcommands, options and their values, as Fig places them", async () => {
		const git = await FIG_SPECS.git?.();
		if (!git) throw new Error("no git spec");
		const parsed = parseArguments(git, [
			"-C",
			"../other",
			"commit",
			"-q",
			"-m",
			"msg",
		]);
		expect(parsed.words.map((word) => [word.kind, word.text])).toEqual([
			["option", "-C"],
			["option_arg", "../other"],
			["subcommand", "commit"],
			["option", "-q"],
			["option", "-m"],
			["option_arg", "msg"],
		]);
	});

	test("a chain of short flags splits, the last taking its value", async () => {
		const grep = await FIG_SPECS.grep?.();
		if (!grep) throw new Error("no grep spec");
		const parsed = parseArguments(grep, ["-cve", "^\\s*$", "a.ts"]);
		expect(
			parsed.words
				.slice(0, 4)
				.map((word) => (word.kind === "option" ? word.flag : word.kind)),
		).toEqual(["-c", "-v", "-e", "option_arg"]);
	});

	test("--name=value and --, by an option the spec defines", async () => {
		const git = await FIG_SPECS.git?.();
		if (!git) throw new Error("no git spec");
		const parsed = parseArguments(git, [
			"commit",
			"--message=fix",
			"--",
			"a.ts",
		]);
		expect(parsed.words.map((word) => [word.kind, word.text])).toEqual([
			["subcommand", "commit"],
			["option", "--message="],
			["option_arg", "fix"],
			["end_of_options", "--"],
			["argument", "a.ts"],
		]);
	});
});

describe("commands in plain words", () => {
	test("a block of code, shown with awk", async () => {
		expect(
			lines(
				await explainCommand(
					"awk '/^function MemberBubble/,/^}/' apps/web/src/session-reader-content.tsx",
				),
			),
		).toEqual([
			'Show a block — Show from the line matching "function MemberBubble (at line start)" to the next line matching "} (at line start)" in [session-reader-content.tsx]',
		]);
	});

	test("a branch switch, a named file, a search kept short and a line count", async () => {
		const command = `git checkout -q feat/x && f=apps/web/src/a.tsx && grep -n "MEMBER_TEXT_CLAMP\\|^function MemberBubble\\|Avatar\\b" $f | head -20; grep -cve '^\\s*$' $f apps/web/src/b.tsx`;
		expect(lines(await explainCommand(command))).toEqual([
			"Switch branch — Switch to `feat/x`",
			"and: · Name a value — `f` is [a.tsx]",
			'and: Search — Find the lines containing "MEMBER_TEXT_CLAMP", "function MemberBubble (at line start)" or "Avatar" in [a.tsx], with line numbers, keeping the first 20 lines',
			"then: Count lines — Count the lines that aren't blank in [a.tsx] and [b.tsx]",
		]);
	});

	test("a commit, a push and a CI watch, filtered", async () => {
		const command = `cd ~/repo && git add -A && git commit -q -m "fix: the thing" && git push -q 2>&1 | tail -1; sleep 90; gh pr checks 301 --watch 2>&1 | grep -v GraphQL | tail -2`;
		expect(lines(await explainCommand(command))).toEqual([
			"· Go to a folder — Go to [repo]",
			"and: Stage — Stage every change",
			'and: Commit — Commit the staged changes with the message "fix: the thing"',
			"and: Push — Push the current branch, keeping the last line",
			"then: Wait — Wait 1 min 30 s",
			'then: Check CI — Check the CI of pull request `#301` and wait for it to finish, dropping the lines containing "GraphQL", keeping the last 2 lines',
		]);
	});

	test("a here-document script, a wrapper and redirects", async () => {
		const command =
			"python3 - <<'EOF'\nimport re\nprint(1)\nEOF\ntimeout 300 bun run vitest run a.test.tsx 2>&1 | tail -6; gh api repos/o/r/actions/jobs/1/logs 2>/dev/null > /tmp/v.log";
		expect(lines(await explainCommand(command))).toEqual([
			"Run a script — Run a 2-line Python script",
			"then: Run tests — Run the tests in [a.test.tsx] (stopped after 5 min), keeping the last 6 lines",
			"then: GitHub API — Read `repos/o/r/actions/jobs/1/logs` from the GitHub API (errors hidden, saved to [v.log])",
		]);
	});

	test("a loop reads as its header and its body", async () => {
		const command = "for n in 301 303; do gh pr view $n --json state; done";
		expect(lines(await explainCommand(command))).toEqual([
			"· Repeat — For each `n` in `301`, `303`:",
			"then: Look at a PR — Look at pull request `#$n`",
		]);
	});

	test("a program without a rule reads as Fig describes it, else as written", async () => {
		const [jq, script] = await explainCommand(
			"jq . a.json; ./scripts/q.sh run",
		);
		expect(jq && render(jq.sentence)).toBe(
			"`jq . a.json`: Command-line JSON processor",
		);
		expect(script && render(script.sentence)).toBe("Run `./scripts/q.sh run`");
	});
});

const GOLDEN: [command: string, explained: string[]][] = [
	[
		"git diff origin/main...feat/x -- apps/web/a.tsx",
		[
			"Show changes — Show the changes in [a.tsx] made on `feat/x` since it branched from `origin/main`",
		],
	],
	[
		"git diff --name-only --diff-filter=U",
		["Show changes — List the changed files, only the conflicted ones"],
	],
	[
		"git diff --cached --stat",
		["Show changes — Summarise the changes, staged only"],
	],
	[
		"git ls-tree --name-only origin/main db/migrations | tail -2",
		[
			"List files — List the files of `origin/main` under [migrations], keeping the last 2 lines",
		],
	],
	[
		"git grep -n 'logo-light\\|logo-dark' -- ':!*.png' | grep -v node_modules | head",
		[
			'Search the repo — Find the lines containing "logo-light" or "logo-dark" in every tracked file under this folder, skipping `*.png`, with line numbers, dropping the lines containing "node_modules", keeping the first 10 lines',
		],
	],
	[
		'git grep -n "const TURN_MARKS" -A25 -- features/sessions',
		[
			'Search the repo — Find the lines containing "const TURN_MARKS" in [sessions], with line numbers, with 25 lines of context after each',
		],
	],
	[
		"git ls-files --others --exclude-standard",
		["List files — List the untracked files, ignored ones left out"],
	],
	["git branch --show-current", ["Branch — Show the current branch's name"]],
	[
		"git log --oneline HEAD..origin/main | head",
		[
			"Show history — Show the history of `HEAD..origin/main`, one line each, keeping the first 10 lines",
		],
	],
	[
		"bun run drizzle:generate --name run_question_label 2>&1 | head -8",
		[
			"Run a script — Run the script `drizzle:generate --name run_question_label`, keeping the first 8 lines",
		],
	],
	[
		"bun run --cwd packages/sql-schema migrate",
		["Run a script — Run the script `migrate` in [sql-schema]"],
	],
	["pnpm --filter web test", ["Run tests — Run the tests for `web`"]],
	[
		"bun test --preload ./src/guard.ts ./src/a.integration.ts 2>&1 | tail -30",
		[
			"Run tests — Run the tests in [a.integration.ts], loading [guard.ts] first, keeping the last 30 lines",
		],
	],
	[
		"bun run shots.ts probe 3d5aad5a after",
		["Run a file — Run [shots.ts] with `probe`, `3d5aad5a` and `after`"],
	],
	[
		"bun x.ts | paste - - - - - | head -12",
		[
			"Run a file — Run [x.ts], joined 5 lines at a time, keeping the first 12 lines",
		],
	],
	[
		"sed -i '' 's/foo/bar/' /tmp/a.ts",
		['Edit — Replace "foo" with "bar" in [a.ts]'],
	],
	[
		'sed -n 1,30p a.ts | grep -n "import\\|from"',
		[
			'Show lines — Show lines 1–30 of [a.ts], keeping the lines containing "import" or "from", with line numbers',
		],
	],
	[
		'for i in 1 2 3; do r=$(grep -E "^\\s+[0-9]+ fail" /tmp/ft.log); if ! echo "$r" | grep -q " 0 fail"; then break; fi; done',
		[
			"· Repeat — For each `i` in `1`, `2`, `3`:",
			"then: Search — Find the lines containing `^\\s+[0-9]+ fail` in [ft.log], remembering what it prints as `$r`",
			"then: · If — If this fails:",
			'then: · Print — Print `$r`, checking for lines containing " 0 fail"',
			"then: · Stop the loop — Stop the loop",
		],
	],
	[
		"for t in $(cut -d' ' -f1 /tmp/rows.txt); do echo $t; done; echo",
		[
			"· Repeat — For each `t` in what this prints:",
			"then: Take columns — Take field 1 of each line of [rows.txt], split at spaces",
			"then: · Print — Print `$t`",
			"then: · Print — Print an empty line",
		],
	],
	[
		"for i in $(seq 1 60); do sleep 2; done; date -u +%T",
		[
			"· Repeat — For each `i` in what this prints:",
			"then: Count — Count from 1 to 60",
			"then: Wait — Wait 2 s",
			"then: Date — Show the date and time in UTC, as `+%T`",
		],
	],
	[
		"rm -rf /tmp/spool-copy; cat -n a.ts b.ts",
		[
			"Delete — Delete [spool-copy] and everything in it, no error if missing",
			"then: Show files — Show [a.ts] and [b.ts], with line numbers",
		],
	],
	[
		'export DBN=live_adv_$(openssl rand -hex 3) && psql "$URL" -c "CREATE DATABASE $DBN"',
		[
			"· Set a name — Set `DBN` to `live_adv_$(openssl rand -hex 3)`",
			"and: Query the database — Run `CREATE DATABASE $DBN` on the database",
		],
	],
	[
		'timeout 60 curl -s -m 60 -u "$U:$P" "$URL/?readonly=1" --data-binary "SELECT 1 FORMAT TSV"',
		[
			"Send a request — Send `SELECT 1 FORMAT TSV` to `$URL/?readonly=1`, logged in as `$U`, giving up after 1 min (stopped after 1 min)",
		],
	],
	[
		"id=$(gh run list --branch main --limit 1 --json databaseId -q '.[0].databaseId'); gh run watch $id",
		[
			"List CI runs — Find the latest CI run on `main`, picking `.[0].databaseId`, remembering what it prints as `$id`",
			"then: Wait for CI — Wait for CI run `$id` to finish",
		],
	],
	[
		"gh api -X PATCH repos/o/r/pulls/506 -f title=New -q .number",
		[
			"Change on GitHub — Send a PATCH to `repos/o/r/pulls/506` on the GitHub API, setting `title`, picking `.number`",
		],
	],
	[
		"command -v vercel doppler; node_modules/.bin/biome --version",
		[
			"Check a program — Check whether `vercel` and `doppler` are installed",
			"then: Version — Show the version of `biome`",
		],
	],
	[
		'grep -rln "TODO" src --include=*.ts | head',
		[
			'Search — List the files with lines containing "TODO" in [src], only in files matching `*.ts`, keeping the first 10 lines',
		],
	],
	[
		'grep "a|b" notes.txt; grep -E "a|b" notes.txt',
		[
			'Search — Find the lines containing "a|b" in [notes.txt]',
			'then: Search — Find the lines containing "a" or "b" in [notes.txt]',
		],
	],
	[
		'find . src -maxdepth 3 -name "*.ts" -newer a.ts',
		[
			'Find files — Find files and folders named "*.ts" under [.] and [src], at most 3 levels deep (also `-newer a.ts`)',
		],
	],
	[
		"git show HEAD:a.json | head -5 | cat -A",
		[
			"Show a file — Show [a.json] as it was at `HEAD`, keeping the first 5 lines, with hidden characters shown",
		],
	],
	[
		"gh run view --job 1 --log 2>&1 | sed -n '/exit=1/,/Post job/p;/(pass)\\|(fail)/p'",
		[
			"Look at a CI run — Look at job `1`, its logs, rewritten by `/exit=1/,/Post job/p;/(pass)\\|(fail)/p`, printing only the lines it picks",
		],
	],
	[
		"sed 's/a/b/;s/c/d/' x.txt",
		["Transform text — Run the sed script `s/a/b/;s/c/d/` of [x.txt]"],
	],
	[
		'python3 -c "\nimport json\nprint(1)" 2>&1 | head -20',
		["Run code — Run 2 lines of Python, keeping the first 20 lines"],
	],
	[
		'for p in "athena 297" "cli 509"; do set -- $p; echo "$1#$2"; done',
		[
			"· Repeat — For each `p` in `athena 297`, `cli 509`:",
			"then: · Set the arguments — Set `$1`, `$2`… to the words of `$p`",
			"then: · Print — Print `$1#$2`",
		],
	],
	[
		"grep -n x a.ts | awk -F: -v n=$n '$1>n' | head -4",
		[
			'Search — Find the lines containing "x" in [a.ts], with line numbers, transformed by `$1>n`, splitting lines at `:`, with `n=$n`, keeping the first 4 lines',
		],
	],
	[
		"awk -F, '{print $2}' a.csv",
		["Show columns — Show column 2 in [a.csv], splitting lines at `,`"],
	],
	[
		"gh pr list --head fix/demo --state all --json number",
		["List PRs — List all the pull requests from `fix/demo`"],
	],
	[
		"gh pr list --state open --limit 30",
		["List PRs — List the open pull requests, at most 30"],
	],
	[
		"git diff --quiet local/combined HEAD -- apps && echo same || git diff --stat local/combined HEAD -- apps",
		[
			"Show changes — Check whether anything changed in [apps] between `local/combined` and `HEAD`",
			"and: · Print — Print `same`",
			"or: Show changes — Summarise the changes in [apps] between `local/combined` and `HEAD`",
		],
	],
	[
		'curl -s localhost:8123 --data "SELECT count() FROM rudel.\\`$t\\`"',
		[
			"Send a request — Send `SELECT count() FROM rudel.`$t`` to `localhost:8123`",
		],
	],
	[
		"find . -name 'wordmark*.svg' -not -path '*/node_modules/*'",
		[
			'Find files — Find files and folders named "wordmark*.svg" under [.], leaving out paths matching "*/node_modules/*"',
		],
	],
	[
		'git diff apps/cli/src/lib/repo-spool.ts | grep -in "x"',
		[
			'Show changes — Show the changes in [repo-spool.ts], keeping the lines containing "x", with line numbers, ignoring case',
		],
	],
	['grep -c "" a.json', ["Count lines — Count the lines in [a.json]"]],
	[
		"git merge-base HEAD main",
		["Find a base — Find the commit where `HEAD` and `main` branched apart"],
	],
	[
		"wc -l < ~/.rudel/logs/hook-upload.log",
		["Count — Count the lines (reading [hook-upload.log])"],
	],
	[
		"tail -n +$(( $(cat /tmp/base.txt) + 1 )) ~/logs/hook.log | cut -c1-200",
		[
			"Show lines — Show [hook.log] from line `$(( $(cat /tmp/base.txt) + 1 ))` on, keeping characters 1–200",
		],
	],
	[
		"tail -n +5 a.log; tail -5 c.log",
		[
			"Show lines — Show [a.log] from line 5 on",
			"then: Show lines — Show the last 5 lines of [c.log]",
		],
	],
	[
		"lsof -tiTCP:4010 -sTCP:LISTEN | head -1",
		[
			"Check a port — See what is using `TCP:4010`, listening only, process ids only, keeping the first line",
		],
	],
	["lsof -i :3000", ["Check a port — See what is using `:3000`"]],
	[
		"sed -i '' 's/await wait(8000)\\n  const t/X/' pix.mjs",
		[
			'Edit — Replace "await wait(8000)\\n  const t" with "X" in [pix.mjs], but it never matches: sed reads one line at a time, so `\\n` finds no line break',
		],
	],
	[
		"stripe prices retrieve price_1UQ --live",
		[
			"stripe — `stripe prices retrieve price_1UQ --live`: CLI interface for Stripe.com",
		],
	],
];

describe("golden set: real commands, checked by hand", () => {
	for (const [command, explained] of GOLDEN)
		test(command, async () => {
			expect(lines(await explainCommand(command))).toEqual(explained);
		});
});

describe("each step's line, as written in the command", () => {
	const linesOf = async (command: string) =>
		(await explainCommand(command)).map((step) => step.raw);

	test("statements, a filter kept with what it filters, redirects kept", async () => {
		expect(
			await linesOf(
				'cd ~/repo && git commit -q -m "fix: the thing" && git push -q 2>&1 | tail -1; sleep 90',
			),
		).toEqual([
			"cd ~/repo",
			'git commit -q -m "fix: the thing"',
			"git push -q 2>&1 | tail -1",
			"sleep 90",
		]);
	});

	test("a loop and a branch: the header's own words, then what follows", async () => {
		expect(
			await linesOf(
				'for i in 1 2; do r=$(grep -E "^ fail" /tmp/ft.log); if ! echo "$r" | grep -q " 0 fail"; then break; fi; done',
			),
		).toEqual([
			"for i in 1 2",
			'do r=$(grep -E "^ fail" /tmp/ft.log)',
			"if !",
			'echo "$r" | grep -q " 0 fail"',
			"then break",
		]);
	});

	test("a loop over a substitution, a helper, backquotes and a here-document", async () => {
		expect(
			await linesOf("for t in $(cut -d' ' -f1 rows.txt); do echo \"$t\"; done"),
		).toEqual(["for t in", "cut -d' ' -f1 rows.txt", 'do echo "$t"']);
		expect(
			await linesOf(
				'q(){ curl -s "$URL" --data-binary "$1"; echo; }\nq "SELECT 1"',
			),
		).toEqual([
			"q(){",
			'curl -s "$URL" --data-binary "$1"',
			"echo",
			'q "SELECT 1"',
		]);
		expect(await linesOf('echo "date: `date -u`" >> /tmp/log.txt')).toEqual([
			'echo "date: `date -u`" >> /tmp/log.txt',
		]);
		expect(
			await linesOf("python3 - <<'EOF'\nprint(1)\nEOF\nbun x.ts | tail -6"),
		).toEqual(["python3 - <<'EOF'", "bun x.ts | tail -6"]);
	});
});

describe("a pipeline's stages, each with its part of the sentence", () => {
	test("the command, then each filter without its pipe or comma", async () => {
		const [step] = await explainCommand(
			'timeout 300 bun run check-types 2>&1 | grep "error TS" | head -5',
		);
		expect(
			step?.stages?.map((stage) => [stage.raw, render(stage.sentence)]),
		).toEqual([
			[
				"timeout 300 bun run check-types 2>&1",
				"Check types: `check-types` (stopped after 5 min)",
			],
			['grep "error TS"', 'keeping the lines containing "error TS"'],
			["head -5", "keeping the first 5 lines"],
		]);
	});

	test("a step of one stage has none; a capture's name lands on the last", async () => {
		const [single] = await explainCommand("sleep 90");
		expect(single?.stages).toBeUndefined();
		const [captured] = await explainCommand(
			"id=$(gh run list --limit 1 | head -1)",
		);
		expect(captured?.stages?.map((stage) => render(stage.sentence))).toEqual([
			"Find the latest CI run",
			"keeping the first line, remembering what it prints as `$id`",
		]);
	});
});

describe("options a sentence doesn't say", () => {
	test("are listed after it as written, never dropped", async () => {
		const said = async (command: string) =>
			lines(await explainCommand(command));
		expect(await said("grep -A 6 --color=never foo src/a.ts")).toEqual([
			'Search — Find the lines containing "foo" in [a.ts], with 6 lines of context after each (also `--color=never`)',
		]);
		expect(await said("ls -la --zzz")).toEqual([
			"List files — List this folder, with details, hidden files included (also `--zzz`)",
		]);
		expect(await said("mkdir -p --verbose x")).toEqual([
			"Create a folder — Create the folder [x] (also `-p` `--verbose`)",
		]);
		expect(await said("cat a.ts | grep -C 2 --zzz err")).toEqual([
			'Show a file — Show [a.ts], keeping the lines containing "err", with 2 lines of context around each (also `--zzz`)',
		]);
	});
});
