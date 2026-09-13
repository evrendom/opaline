import { describe, expect, test } from "bun:test";
import { type RepoIdentity, resolveRepoIdentity } from "../repo-identity.js";

describe("resolveRepoIdentity", () => {
	test("uses the Conductor repo token before the git remote", () => {
		expect(
			resolveRepoIdentity({
				projectPath: "/Users/x/conductor/workspaces/rudel-v2/podgorica",
				gitRemote: "github.com/evrendom/rudel",
				packageName: null,
			}),
		).toEqual({
			repoKey: "path:rudel-v2",
			repoLabel: "rudel-v2",
			repoName: "rudel-v2",
			source: "worktree",
			worktree: "podgorica",
		});
	});

	test("resolves a cwd below the Conductor worktree root", () => {
		expect(
			resolveRepoIdentity({
				projectPath:
					"/Users/x/conductor/workspaces/rudel-v2/podgorica/apps/web",
				gitRemote: null,
				packageName: null,
			}),
		).toEqual({
			repoKey: "path:rudel-v2",
			repoLabel: "rudel-v2",
			repoName: "rudel-v2",
			source: "worktree",
			worktree: "podgorica",
		});
	});

	test("resolves generic dot-worktrees paths", () => {
		const expected: RepoIdentity = {
			repoKey: "path:myrepo",
			repoLabel: "myrepo",
			repoName: "myrepo",
			source: "worktree",
			worktree: "feature-x",
		};

		expect(
			resolveRepoIdentity({
				projectPath: "/Users/x/dev/myrepo/.worktrees/feature-x",
				gitRemote: null,
				packageName: null,
			}),
		).toEqual(expected);
		expect(
			resolveRepoIdentity({
				projectPath: [
					"C:",
					"Users",
					"x",
					"dev",
					"myrepo",
					".worktrees",
					"feature-x",
				].join("\\"),
				gitRemote: null,
				packageName: null,
			}),
		).toEqual(expected);
		expect(
			resolveRepoIdentity({
				projectPath: ["C:", "dev", "repo", ".worktrees", "feature"].join("\\"),
				gitRemote: null,
				packageName: null,
			}),
		).toEqual({
			repoKey: "path:repo",
			repoLabel: "repo",
			repoName: "repo",
			source: "worktree",
			worktree: "feature",
		});
	});

	test("canonicalizes normalized, HTTPS, SSH, and scp-style remotes", () => {
		const remotes = [
			"github.com/acmedata/flick",
			"https://GitHub.COM/acmedata/flick.git",
			"ssh://git@github.com/acmedata/flick.git",
			"git@github.com:acmedata/flick.git",
		];

		for (const gitRemote of remotes) {
			expect(
				resolveRepoIdentity({
					projectPath: "/tmp/checkout",
					gitRemote,
					packageName: null,
				}),
			).toEqual({
				repoKey: "remote:github.com/acmedata/flick",
				repoLabel: "acmedata/flick",
				repoName: "flick",
				source: "remote",
				worktree: null,
			});
		}
	});

	test("falls back through remote, package, path, and empty identities", () => {
		expect(
			resolveRepoIdentity({
				projectPath: "/tmp/checkout",
				gitRemote: "github.com/owner/repo",
				packageName: "ignored-package",
			}),
		).toEqual({
			repoKey: "remote:github.com/owner/repo",
			repoLabel: "owner/repo",
			repoName: "repo",
			source: "remote",
			worktree: null,
		});
		expect(
			resolveRepoIdentity({
				projectPath: "/tmp/checkout",
				gitRemote: null,
				packageName: "@rudel/web",
			}),
		).toEqual({
			repoKey: "pkg:@rudel/web",
			repoLabel: "@rudel/web",
			repoName: "web",
			source: "package",
			worktree: null,
		});
		expect(
			resolveRepoIdentity({
				projectPath: "/Users/x/dev/myrepo",
				gitRemote: null,
				packageName: null,
			}),
		).toEqual({
			repoKey: "path-raw:/Users/x/dev/myrepo",
			repoLabel: "dev/myrepo",
			repoName: null,
			source: "unresolved",
			worktree: null,
		});
		expect(
			resolveRepoIdentity({
				projectPath: "",
				gitRemote: null,
				packageName: null,
			}),
		).toEqual({
			repoKey: "path-raw:",
			repoLabel: "Untitled project",
			repoName: null,
			source: "unresolved",
			worktree: null,
		});
	});

	test("extracts scoped package names without weakening their keys", () => {
		expect(
			resolveRepoIdentity({
				projectPath: "/tmp/checkout",
				gitRemote: null,
				packageName: "@scope/pkg",
			}),
		).toEqual({
			repoKey: "pkg:@scope/pkg",
			repoLabel: "@scope/pkg",
			repoName: "pkg",
			source: "package",
			worktree: null,
		});
	});

	test("keeps unresolved raw paths namespaced without inventing a name", () => {
		const projectPath = ["", "Users", "evrendombak"].join("/");

		expect(
			resolveRepoIdentity({
				projectPath,
				gitRemote: null,
				packageName: null,
			}),
		).toEqual({
			repoKey: `path-raw:${projectPath}`,
			repoLabel: "Users/evrendombak",
			repoName: null,
			source: "unresolved",
			worktree: null,
		});
	});

	test("does not add special handling for Vibe Kanban or Gastown paths", () => {
		expect(
			resolveRepoIdentity({
				projectPath: "/var/folders/zz/T/vibe-kanban/worktrees/abc123-task",
				gitRemote: null,
				packageName: null,
			}),
		).toEqual({
			repoKey: "path-raw:/var/folders/zz/T/vibe-kanban/worktrees/abc123-task",
			repoLabel: "worktrees/abc123-task",
			repoName: null,
			source: "unresolved",
			worktree: null,
		});
		expect(
			resolveRepoIdentity({
				projectPath: "/Users/x/gt/rudel/polecats/worker-1",
				gitRemote: null,
				packageName: null,
			}),
		).toEqual({
			repoKey: "path-raw:/Users/x/gt/rudel/polecats/worker-1",
			repoLabel: "polecats/worker-1",
			repoName: null,
			source: "unresolved",
			worktree: null,
		});
	});
});
