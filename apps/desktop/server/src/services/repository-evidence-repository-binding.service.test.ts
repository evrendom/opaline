import { describe, expect, test } from "bun:test";
import type { RepositoryEvidenceRepositoryIdentity } from "@rudel/api-routes";
import {
	RepositoryEvidenceRepositoryBindingError,
	resolveTrustedRepositoryIdentity,
} from "./repository-evidence-repository-binding.service.js";

const local = {
	installationId: "00000000-0000-4000-8000-000000000001",
	repositoryId: `local-repository:${"a".repeat(64)}`,
	worktreeId: `local-worktree:${"b".repeat(64)}`,
};

describe("repository evidence provider binding", () => {
	test("resolves a client hint to the server-owned GitHub repository identity", async () => {
		const repository: RepositoryEvidenceRepositoryIdentity = {
			local,
			provider: null,
			remoteHint: {
				host: "github.com",
				name: "Athena",
				owner: "OpalineHQ",
				provider: "github",
			},
		};
		const resolved = await resolveTrustedRepositoryIdentity({
			lookup: async (input) => {
				expect(input).toEqual({
					name: "Athena",
					organizationId: "organization-1",
					owner: "OpalineHQ",
				});
				return {
					name: "athena",
					nodeId: "R_athena",
					owner: "opalinehq",
					repositoryId: "12345",
				};
			},
			organizationId: "organization-1",
			repository,
		});
		expect(resolved.provider).toEqual({
			host: "github.com",
			name: "athena",
			nodeId: "R_athena",
			owner: "opalinehq",
			provider: "github",
			repositoryId: "12345",
		});
		expect(resolved.local).toEqual(local);
	});

	test("keeps an unbound or absent remote hint explicitly unresolved", async () => {
		const lookup = async () => null;
		expect(
			await resolveTrustedRepositoryIdentity({
				lookup,
				organizationId: "organization-1",
				repository: { local, provider: null, remoteHint: null },
			}),
		).toEqual({ local, provider: null, remoteHint: null });
		expect(
			(
				await resolveTrustedRepositoryIdentity({
					lookup,
					organizationId: "organization-1",
					repository: {
						local,
						provider: null,
						remoteHint: {
							host: "github.com",
							name: "missing",
							owner: "opalinehq",
							provider: "github",
						},
					},
				})
			).provider,
		).toBeNull();
	});

	test("rejects a provider identity supplied by the client", async () => {
		await expect(
			resolveTrustedRepositoryIdentity({
				lookup: async () => null,
				organizationId: "organization-1",
				repository: {
					local,
					provider: {
						host: "github.com",
						name: "athena",
						nodeId: "spoofed",
						owner: "opalinehq",
						provider: "github",
						repositoryId: "999",
					},
					remoteHint: null,
				},
			}),
		).rejects.toBeInstanceOf(RepositoryEvidenceRepositoryBindingError);
	});
});
