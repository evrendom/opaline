import { describe, expect, test } from "bun:test";
import {
	commandChain,
	commandIdentity,
	describeCommand,
	splitLeadingCd,
} from "./command-identity.js";

describe("command identity", () => {
	test.each([
		["cd ~/repo && git push -q 2>&1 | tail -1", "git", "git push"],
		["cd ~/repo && sleep 60; gh pr checks 301 --watch", "sleep", "sleep"],
		["timeout 300 bun run vitest run x.test.tsx", "bun", "bun run"],
		["export A=1; sudo -E make build", "make", "make build"],
		["git -C ../other status", "git", "git status"],
		["python3 -m pytest -q", "python3", "python3 -m pytest"],
		["bash -lc 'gh run view 42 --log'", "gh", "gh run"],
		["/usr/bin/sed -n 1,20p a.ts", "sed", "sed"],
		['echo "== tests ==" && mkdir -p out', "mkdir", "mkdir"],
	])("%s", (command, argv0, prefix) => {
		expect(commandIdentity(command)).toEqual({ argv0, prefix });
	});

	test("a lone cd is the command; nothing at all names nothing", () => {
		expect(commandIdentity("cd ~/repo")).toEqual({
			argv0: "cd",
			prefix: "cd",
		});
		expect(commandIdentity("")).toBeNull();
	});
});

describe("leading cd", () => {
	test.each([
		[
			"cd ~/coding-projects/athena && rm -rf /tmp/x",
			"rm -rf /tmp/x",
			"~/coding-projects/athena",
		],
		[
			"cd ~/repo; cd apps/web && bun run check-types",
			"bun run check-types",
			"~/repo/apps/web",
		],
		['cd "/tmp/a b" && ls', "ls", "/tmp/a b"],
		["git status", "git status", null],
		["cd ~/repo", "cd ~/repo", null],
		["cd ~/repo || exit 1", "cd ~/repo || exit 1", null],
	])("%s", (command, rest, dir) => {
		expect(splitLeadingCd(command)).toEqual({ command: rest, dir });
	});
});

describe("command chain", () => {
	test.each([
		[
			'cd ~/coding-projects/athena-rq-dashboard && rm -rf /tmp/biome-check/apps /tmp/biome-check/packages && f=apps/web/src/features/sessions/components/sessions-overview-table.tsx && mkdir -p "/tmp/biome-check/$(dirname $f)" && cp $f /tmp/biome-check/$f && cd /tmp/biome-check && bun run biome check --vcs-enabled=false . 2>&1 | tail -3',
			"rm · mkdir · cp · bun run | tail",
		],
		[
			'cd ~/repo && sleep 60; for n in 301 303; do gh pr view $n --json mergeable -q ".mergeable"; done; gh pr checks 301 --watch 2>&1 | grep -v GraphQL | tail -2',
			"sleep · gh pr · gh pr | grep | tail",
		],
		["cd ~/repo && git push -q", "git push"],
		["grep -n a x | head -3; grep -n b y | head -3", "grep | head ×2"],
		["lsof -a -p $(lsof -ti tcp:4011) -d cwd -Fn | tail -1", "lsof | tail"],
		["[ -f a.txt ] && sleep 5; cat a.txt", "sleep · cat"],
		["for n in 1 2; do echo $(gh pr view $n); done", "gh pr"],
		['echo "== x ==" && export A=1', null],
		["cd ~/repo", null],
	])("%s", (command, chain) => {
		expect(commandChain(command)).toBe(chain);
	});
});

describe("describe command", () => {
	test.each([
		[
			'cd ~/x && rm -rf /tmp/b/apps && f=a.tsx && mkdir -p "/tmp/b/$(dirname $f)" && cp $f /tmp/b/$f && cd /tmp/b && bun run biome check --vcs-enabled=false . 2>&1 | tail -3',
			"lint",
			"bun run",
		],
		[
			"cd ~/x && git add -A && git commit -q -m x && git push -q",
			"git",
			"git push",
		],
		["sleep 60; gh pr checks 301 --watch | tail -2", "github", "gh pr"],
		["sed -n 1,20p a.ts; grep -n x b.ts | head", "read", "sed"],
		["python3 - <<'EOF'\nprint(1)\nEOF", "script", "python3"],
		["cd ~/x && timeout 300 bun run vitest run a.test.tsx", "test", "bun run"],
		["sleep 30", "wait", "sleep"],
	])("%s", (command, kind, lead) => {
		expect(describeCommand(command)).toMatchObject({ kind, lead });
	});
});
