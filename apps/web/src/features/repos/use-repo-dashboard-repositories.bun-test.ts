import { expect, test } from "bun:test";
import {
	dashboardRepositoryId,
	githubRepositoryIds,
} from "./use-repo-dashboard-repositories";

test("matches the dashboard's repository ids", () => {
	const id = (git_remote: string | undefined, project_path = "/code/app") =>
		dashboardRepositoryId({ git_remote, project_path });
	expect(id("git@github.com:opalinehq/athena.git")).toBe(
		"github.com/opalinehq/athena",
	);
	expect(id("https://github.com/opalinehq/athena")).toBe(
		"github.com/opalinehq/athena",
	);
	expect(id("ssh://git@gitlab.com/team/app.git/")).toBe("gitlab.com/team/app");
	for (const remote of [
		"https://git.example.com:8443/team/app.git",
		"https://oauth2:token@git.example.com:8443/team/app.git",
		"ssh://git@git.example.com:2222/team/app.git",
		"git://git.example.com/team/app.git",
		"deploy@git.example.com:team/app.git",
		"git.example.com/team/app",
	])
		expect(id(remote)).toBe("git.example.com/team/app");
	expect(id(undefined, "/Users/me/rudel-v2")).toBe("/Users/me/rudel-v2");
	expect(id("", "/Users/me/rudel-v2")).toBe("/Users/me/rudel-v2");
});

test("finds the repo's connected GitHub repositories", () => {
	const connected = [
		{ owner: "OpalineHQ", name: "Athena", repositoryId: "11" },
		{ owner: "opalinehq", name: "cli", repositoryId: "12" },
	];
	expect(
		githubRepositoryIds(
			["github.com/opalinehq/athena", "/Users/me/athena"],
			connected,
		),
	).toEqual(["11"]);
	expect(githubRepositoryIds(["/Users/me/scratch"], connected)).toEqual([]);
});
