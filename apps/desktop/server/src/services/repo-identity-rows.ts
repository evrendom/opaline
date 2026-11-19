import type { RepoIdentityInput } from "@rudel/api-routes";

export function toRepoIdentityInput(row: {
	git_remote: string | null;
	package_name: string | null;
	project_path: string;
}): RepoIdentityInput {
	return {
		gitRemote: row.git_remote || null,
		packageName: row.package_name || null,
		projectPath: row.project_path,
	};
}
