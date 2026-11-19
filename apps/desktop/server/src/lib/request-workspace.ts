import { ORPCError } from "@orpc/server";
import { WORKSPACE_REQUEST_HEADER } from "@rudel/api-routes/rpc-batch";

type HeaderValue = string | readonly string[] | undefined;

export function readRequestedWorkspace(
	headers: Readonly<Record<string, HeaderValue>>,
): string | null {
	const value = headers[WORKSPACE_REQUEST_HEADER];
	const workspace = (Array.isArray(value) ? value[0] : value)?.trim();
	return workspace ? workspace : null;
}

export interface ResolvedWorkspace<T> {
	readonly organizationId: string;
	readonly member: T;
}

export interface RequestWorkspaceLookup<T> {
	readonly readMember: (
		organizationId: string,
		userId: string,
	) => Promise<T | null>;
	readonly readMemberBySlug: (
		slug: string,
		userId: string,
	) => Promise<ResolvedWorkspace<T> | null>;
}

export type RequestWorkspaceLookups = Map<string, Promise<unknown>>;

export function createRequestWorkspaceLookups(): RequestWorkspaceLookups {
	return new Map();
}

export async function resolveRequestWorkspace<T>(
	input: {
		readonly requestedWorkspace: string | null | undefined;
		readonly session: object;
		readonly userId: string;
		readonly lookups?: RequestWorkspaceLookups;
	},
	lookup: RequestWorkspaceLookup<T>,
): Promise<ResolvedWorkspace<T>> {
	const once = <R>(key: unknown[], read: () => Promise<R>): Promise<R> => {
		if (!input.lookups) return read();
		const name = JSON.stringify(key);
		let pending = input.lookups.get(name) as Promise<R> | undefined;
		if (!pending) {
			pending = read();
			input.lookups.set(name, pending);
		}
		return pending;
	};
	const { requestedWorkspace, userId } = input;
	if (requestedWorkspace) {
		const found = await once(["slug", requestedWorkspace, userId], () =>
			lookup.readMemberBySlug(requestedWorkspace, userId),
		);
		if (!found) throw notAMember();
		return found;
	}
	const organizationId =
		(input.session as Record<string, unknown>).activeOrganizationId ?? userId;
	if (!organizationId || typeof organizationId !== "string") {
		throw new ORPCError("BAD_REQUEST", {
			message: "No active organization",
		});
	}
	const member = await once(["id", organizationId, userId], () =>
		lookup.readMember(organizationId, userId),
	);
	if (!member) throw notAMember();
	return { organizationId, member };
}

function notAMember() {
	return new ORPCError("FORBIDDEN", {
		message: "Not a member of the active organization",
	});
}
