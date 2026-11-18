import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import { WORKSPACE_REQUEST_HEADER } from "@rudel/api-routes/rpc-batch";
import {
	createRequestWorkspaceLookups,
	readRequestedWorkspace,
	resolveRequestWorkspace,
} from "./request-workspace.js";

const memberships: Record<string, { slug: string; role: string }> = {
	"org-a/user-1": { slug: "acme", role: "admin" },
	"org-b/user-1": { slug: "beta", role: "member" },
	"org-c/user-2": { slug: "gamma", role: "owner" },
};

function lookup() {
	const calls: string[] = [];
	return {
		calls,
		readMember: async (organizationId: string, userId: string) => {
			calls.push(`member ${organizationId}/${userId}`);
			const found = memberships[`${organizationId}/${userId}`];
			return found ? { role: found.role } : null;
		},
		readMemberBySlug: async (slug: string, userId: string) => {
			calls.push(`slug ${slug}/${userId}`);
			for (const [key, found] of Object.entries(memberships)) {
				const [organizationId, member] = key.split("/");
				if (found.slug === slug && member === userId && organizationId)
					return { organizationId, member: { role: found.role } };
			}
			return null;
		},
	};
}

async function refusal(promise: Promise<unknown>) {
	const error = await promise.then(
		() => null,
		(cause: unknown) => cause,
	);
	expect(error).toBeInstanceOf(ORPCError);
	return error as ORPCError<string, unknown>;
}

describe("request workspace", () => {
	test("the header picks the URL's workspace for a member, not the session's", async () => {
		const resolved = await resolveRequestWorkspace(
			{
				requestedWorkspace: "beta",
				session: { activeOrganizationId: "org-a" },
				userId: "user-1",
			},
			lookup(),
		);
		expect(resolved).toEqual({
			organizationId: "org-b",
			member: { role: "member" },
		});
	});

	test("a header for a workspace the user is not in is refused like today", async () => {
		const sessionNonMember = await refusal(
			resolveRequestWorkspace(
				{
					requestedWorkspace: null,
					session: { activeOrganizationId: "org-c" },
					userId: "user-1",
				},
				lookup(),
			),
		);
		for (const requestedWorkspace of ["gamma", "missing"]) {
			const error = await refusal(
				resolveRequestWorkspace(
					{
						requestedWorkspace,
						session: { activeOrganizationId: "org-a" },
						userId: "user-1",
					},
					lookup(),
				),
			);
			expect(error.code).toBe("FORBIDDEN");
			expect(error.message).toBe(sessionNonMember.message);
		}
	});

	test("without the header the session's active workspace is used", async () => {
		const source = lookup();
		const resolved = await resolveRequestWorkspace(
			{
				requestedWorkspace: undefined,
				session: { activeOrganizationId: "org-a" },
				userId: "user-1",
			},
			source,
		);
		expect(resolved.organizationId).toBe("org-a");
		expect(source.calls).toEqual(["member org-a/user-1"]);
		const missing = await refusal(
			resolveRequestWorkspace(
				{ requestedWorkspace: null, session: {}, userId: "user-1" },
				source,
			),
		);
		expect(missing.code).toBe("FORBIDDEN");
	});

	test("reads the header by its lowercase name and ignores blanks", () => {
		expect(readRequestedWorkspace({ [WORKSPACE_REQUEST_HEADER]: "acme" })).toBe(
			"acme",
		);
		expect(
			readRequestedWorkspace({ [WORKSPACE_REQUEST_HEADER]: ["beta", "acme"] }),
		).toBe("beta");
		expect(readRequestedWorkspace({ [WORKSPACE_REQUEST_HEADER]: " " })).toBe(
			null,
		);
		expect(readRequestedWorkspace({})).toBe(null);
	});
});

describe("membership lookups within one request", () => {
	test("a batch checks each membership once, and the next request checks again", async () => {
		const source = lookup();
		const resolve = (
			lookups: ReturnType<typeof createRequestWorkspaceLookups>,
			requestedWorkspace: string | null,
		) =>
			resolveRequestWorkspace(
				{
					requestedWorkspace,
					session: { activeOrganizationId: "org-a" },
					userId: "user-1",
					lookups,
				},
				source,
			);
		const batch = createRequestWorkspaceLookups();
		await Promise.all([
			resolve(batch, "beta"),
			resolve(batch, "beta"),
			resolve(batch, null),
			resolve(batch, null),
		]);
		expect(source.calls).toEqual(["slug beta/user-1", "member org-a/user-1"]);
		await resolve(createRequestWorkspaceLookups(), "beta");
		await resolve(createRequestWorkspaceLookups(), "beta");
		expect(source.calls).toHaveLength(4);
	});
});
