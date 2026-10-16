import { describe, expect, test } from "bun:test";
import {
	callDirectory,
	type DirectoryEvidenceRow,
	directoryRepositories,
	directoryRepository,
	runDirectoryColumns,
	runDirectoryRules,
} from "./run-directories.js";
import { RUN_FORK_REPLAY, RUN_INDEX_PRICING_VERSION } from "./run-index-sql.js";

const COORDINATOR = "/Users/ana/launch";
const call = (
	cdTarget: string,
	command: string,
	output: string,
	recordedCwd = COORDINATOR,
): DirectoryEvidenceRow => ({
	evidence: "call",
	agent_id: "a1",
	first_record: 1,
	cd_target: cdTarget,
	recorded_cwd: recordedCwd,
	command,
	output,
});
const SESSION = { projectPath: COORDINATOR, gitRemote: "github.com/acme/shop" };

describe("callDirectory", () => {
	test("a literal move wins over the recorded cwd; ~ is the recorded cwd's home", () => {
		expect(callDirectory("", COORDINATOR)).toBe(COORDINATOR);
		expect(callDirectory("/Users/ana/code/cli/", COORDINATOR)).toBe(
			"/Users/ana/code/cli",
		);
		expect(callDirectory("~/code/cli", COORDINATOR)).toBe(
			"/Users/ana/code/cli",
		);
		expect(callDirectory("'/Users/ana/my repo'", COORDINATOR)).toBe(
			"/Users/ana/my repo",
		);
		expect(callDirectory("apps/api", "/Users/ana/code/cli")).toBe(
			"/Users/ana/code/cli/apps/api",
		);
		expect(callDirectory("../cli", "/Users/ana/code/shop")).toBe(
			"/Users/ana/code/cli",
		);
	});

	test("a target that is not literal, or cannot be placed, is unknown", () => {
		expect(callDirectory("?", COORDINATOR)).toBeNull();
		expect(callDirectory("-", COORDINATOR)).toBeNull();
		expect(callDirectory("~bob/x", COORDINATOR)).toBeNull();
		expect(callDirectory("apps", "")).toBeNull();
		expect(callDirectory("", "")).toBeNull();
		// No home to read ~ against: kept as written.
		expect(callDirectory("~/x", "/private/tmp")).toBe("~/x");
	});
});

describe("directoryRepositories", () => {
	test("a push, a fetch, a remote query and gh output tie the directory they ran in", () => {
		expect(
			directoryRepositories(
				[
					call(
						"~/code/cli",
						"cd ~/code/cli && git push -u origin feat/x",
						"remote: Create a pull request\nTo github.com:acme/cli.git\n * [new branch]      feat/x -> feat/x",
					),
					call(
						"/Users/ana/code/api",
						"cd /Users/ana/code/api && git fetch origin",
						"From https://github.com/acme/api\n * branch main -> FETCH_HEAD",
					),
					call(
						"/Users/ana/code/web",
						"cd /Users/ana/code/web && git remote -v",
						"origin\tgit@github.com:acme/web.git (fetch)\norigin\tgit@github.com:acme/web.git (push)\nupstream\thttps://github.com/other/web.git (fetch)",
					),
					call(
						"/Users/ana/code/docs",
						"cd /Users/ana/code/docs && git remote get-url origin",
						"https://ci:secret@github.com/acme/docs.git",
					),
					call(
						"/Users/ana/code/app",
						"cd /Users/ana/code/app && gh pr checks 12",
						"build\tpass\t1m\thttps://github.com/acme/app/actions/runs/1/job/2\nlint\tpass\t9s\thttps://github.com/acme/app/actions/runs/1/job/3",
					),
					call(
						"/Users/ana/code/app2",
						"cd /Users/ana/code/app2 && gh pr create --fill",
						"Creating pull request for feat into main\n\nhttps://github.com/acme/app2/pull/7",
					),
				],
				SESSION,
			),
		).toEqual([
			{
				directory: "/Users/ana/code/cli",
				repository: "github.com/acme/cli",
				basis: "transfer_remote",
			},
			{
				directory: "/Users/ana/code/api",
				repository: "github.com/acme/api",
				basis: "transfer_remote",
			},
			{
				directory: "/Users/ana/code/web",
				repository: "github.com/acme/web",
				basis: "remote_output",
			},
			{
				directory: "/Users/ana/code/docs",
				repository: "github.com/acme/docs",
				basis: "remote_output",
			},
			{
				directory: "/Users/ana/code/app",
				repository: "github.com/acme/app",
				basis: "gh_output",
			},
			{
				directory: "/Users/ana/code/app2",
				repository: "github.com/acme/app2",
				basis: "gh_output",
			},
		]);
	});

	test("output that may be another directory's ties nothing", () => {
		expect(
			directoryRepositories(
				[
					// It moved again after its leading move.
					call(
						"~/code/cli",
						"cd ~/code/cli && git status; cd ~/code/api && git push",
						"To github.com:acme/api.git",
					),
					// No leading move: a later cd, then the push.
					call(
						"",
						"cat > /tmp/body.md <<'EOF'\nx\nEOF\ncd ~/code/api && gh pr create -F /tmp/body.md",
						"https://github.com/acme/api/pull/3",
					),
					// git and gh pointed at another repository.
					call(
						"~/code/cli",
						"cd ~/code/cli && git -C ../api push",
						"To github.com:acme/api.git",
					),
					call(
						"~/code/cli",
						"cd ~/code/cli && gh pr view 4 -R acme/api",
						"https://github.com/acme/api/pull/4",
					),
					call(
						"~/code/cli",
						"cd ~/code/cli && gh pr list --repo acme/api",
						"https://github.com/acme/api/pull/4",
					),
					// Two repositories in one output.
					call(
						"~/code/cli",
						"cd ~/code/cli && gh pr checks 9",
						"a\tpass\thttps://github.com/acme/cli/actions/runs/1\nb\tpass\thttps://github.com/acme/api/actions/runs/2",
					),
					// A push that printed no remote, and a target that is not literal.
					call("~/code/cli", "cd ~/code/cli && git push -q", ""),
					call("?", "cd $REPO && git push", "To github.com:acme/cli.git"),
				],
				SESSION,
			),
		).toEqual([]);
	});

	test("session evidence: a Codex session_meta's remote, and the upload's remote where the upload's branch was recorded", () => {
		const meta = (cwd: string, remote: string): DirectoryEvidenceRow => ({
			...call("", "", remote, cwd),
			evidence: "codex_session_meta",
		});
		expect(
			directoryRepositories(
				[
					meta("/work/widget", "https://github.com/acme/widget.git"),
					meta("/work/none", ""),
					{ ...call("", "", ""), evidence: "session_branch" },
				],
				SESSION,
			),
		).toEqual([
			{
				directory: "/work/widget",
				repository: "github.com/acme/widget",
				basis: "codex_session_meta",
			},
			{
				directory: COORDINATOR,
				repository: "github.com/acme/shop",
				basis: "session_branch",
			},
		]);
		// No session remote: the branch ties nothing.
		expect(
			directoryRepositories(
				[{ ...call("", "", ""), evidence: "session_branch" }],
				{ projectPath: COORDINATOR, gitRemote: "" },
			),
		).toEqual([]);
	});
});

describe("directoryRepository", () => {
	const known = [
		{
			directory: "/Users/ana/code/cli",
			repository: "github.com/acme/cli",
			basis: "gh_output" as const,
		},
		{
			directory: "/Users/ana/code/cli",
			repository: "github.com/acme/cli",
			basis: "transfer_remote" as const,
		},
		{
			directory: "/Users/ana/code/cli/vendor/lib",
			repository: "github.com/other/lib",
			basis: "remote_output" as const,
		},
		{
			directory: "/Users/ana/code/mixed",
			repository: "github.com/acme/a",
			basis: "gh_output" as const,
		},
		{
			directory: "/Users/ana/code/mixed",
			repository: "github.com/acme/b",
			basis: "gh_output" as const,
		},
	];
	test("the deepest directory with evidence at or above it decides, with its strongest basis", () => {
		expect(directoryRepository("/Users/ana/code/cli", known)).toEqual({
			cwd_repository: "github.com/acme/cli",
			cwd_repository_basis: "transfer_remote",
		});
		expect(directoryRepository("/Users/ana/code/cli/apps/x", known)).toEqual({
			cwd_repository: "github.com/acme/cli",
			cwd_repository_basis: "transfer_remote",
		});
		expect(
			directoryRepository("/Users/ana/code/cli/vendor/lib/src", known),
		).toEqual({
			cwd_repository: "github.com/other/lib",
			cwd_repository_basis: "remote_output",
		});
	});

	test("no evidence, a sibling with a shared prefix, or two repositories: unknown", () => {
		expect(directoryRepository("/Users/ana/code/cli-live", known)).toEqual({
			cwd_repository: null,
			cwd_repository_basis: "",
		});
		expect(directoryRepository("/Users/ana/code", known)).toEqual({
			cwd_repository: null,
			cwd_repository_basis: "",
		});
		expect(directoryRepository("/Users/ana/code/mixed/x", known)).toEqual({
			cwd_repository: null,
			cwd_repository_basis: "conflicting",
		});
		expect(directoryRepository(null, known)).toEqual({
			cwd_repository: null,
			cwd_repository_basis: "",
		});
	});
});

describe("runDirectoryColumns", () => {
	const known = [
		{
			directory: "/Users/ana/code/cli",
			repository: "github.com/acme/cli",
			basis: "transfer_remote" as const,
		},
	];
	const shell = (
		turn: number,
		cdTarget: string,
		calls: number,
		first: number,
		agentId = "a1",
	) => ({
		agent_id: agentId,
		turn_idx: turn,
		shell: 1,
		cd_target: cdTarget,
		recorded_cwd: COORDINATOR,
		calls,
		first_record: first,
	});
	const firstCwd = (turn: number, cwd: string, agentId = "a1") => ({
		agent_id: agentId,
		turn_idx: turn,
		shell: 0,
		cd_target: "",
		recorded_cwd: cwd,
		calls: 0,
		first_record: 0,
	});
	const columns = runDirectoryColumns(
		[
			// Run 1: 3 calls in the coordinator folder, 4 in one checkout's folders.
			firstCwd(1, COORDINATOR),
			shell(1, "", 3, 10),
			shell(1, "~/code/cli/apps/api", 2, 20),
			shell(1, "/Users/ana/code/cli", 2, 30),
			// Run 2: a tie, the earlier directory wins; no evidence there.
			shell(2, "/tmp/a", 2, 50),
			shell(2, "/tmp/b", 2, 40),
			// Run 3: no shell calls; its first recorded cwd.
			firstCwd(3, "/Users/ana/code/cli/src"),
			// Run 4: only a move that is not literal.
			firstCwd(4, COORDINATOR),
			shell(4, "?", 5, 60),
		],
		known,
	);
	test("most shell calls decide, a checkout's folders counting for the checkout", () => {
		expect(columns("a1", 1)).toEqual({
			cwd: "/Users/ana/code/cli",
			cwd_repository: "github.com/acme/cli",
			cwd_repository_basis: "transfer_remote",
		});
		expect(columns("a1", 2)).toEqual({
			cwd: "/tmp/b",
			cwd_repository: null,
			cwd_repository_basis: "",
		});
	});
	test("without shell calls whose directory is known, the first recorded cwd; without any, nothing", () => {
		expect(columns("a1", 3)).toEqual({
			cwd: "/Users/ana/code/cli/src",
			cwd_repository: "github.com/acme/cli",
			cwd_repository_basis: "transfer_remote",
		});
		expect(columns("a1", 4)).toEqual({
			cwd: COORDINATOR,
			cwd_repository: null,
			cwd_repository_basis: "",
		});
		expect(columns("a2", 1)).toEqual({
			cwd: null,
			cwd_repository: null,
			cwd_repository_basis: "",
		});
	});
});

test("the directory rules fingerprint the run index build", () => {
	expect(runDirectoryRules(RUN_FORK_REPLAY)).toContain("cwd_components");
	expect(RUN_INDEX_PRICING_VERSION).toMatch(/\+[0-9a-f]{12}$/u);
});
