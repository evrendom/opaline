import { ORPCError } from "@orpc/server";
import type postgres from "postgres";
import { sqlClient } from "../db.js";
import { readWorkspaceMember } from "./session-reader.service.js";
import type { SessionReader } from "./session-visibility.js";

export async function resolveIngestOrganizationId(
	requestedOrganizationId: string | null,
	userId: string,
	sql: postgres.Sql = sqlClient,
): Promise<string> {
	if (requestedOrganizationId) {
		const membership = await sql<Array<{ id: string }>>`
			SELECT id
			FROM member
			WHERE organization_id = ${requestedOrganizationId}
				AND user_id = ${userId}
			LIMIT 1
		`;

		if (membership.length === 0) {
			throw new ORPCError("FORBIDDEN", {
				message: "Not a member of the specified organization",
			});
		}
		return requestedOrganizationId;
	}

	// Two rows are enough to distinguish a sole membership from an ambiguous choice.
	// Prefer the personal workspace when it exists; creation time makes the fallback deterministic.
	const memberships = await sql<Array<{ organization_id: string }>>`
		SELECT m.organization_id
		FROM member m
		INNER JOIN organization o
			ON o.id = m.organization_id
		WHERE m.user_id = ${userId}
		GROUP BY m.organization_id
		ORDER BY (m.organization_id = ${userId}) DESC, MIN(m.created_at) ASC
		LIMIT 2
	`;
	const personalWorkspace = memberships.find(
		(membership) => membership.organization_id === userId,
	);
	if (personalWorkspace) {
		return personalWorkspace.organization_id;
	}
	if (memberships.length === 1 && memberships[0]) {
		return memberships[0].organization_id;
	}
	if (memberships.length === 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: "No organization is available for this upload",
		});
	}

	throw new ORPCError("BAD_REQUEST", {
		message: "Choose an organization with --org or opaline set-org",
	});
}

export function getActiveOrganizationId(session: unknown): string | null {
	if (typeof session !== "object" || session === null) {
		return null;
	}
	if (!("activeOrganizationId" in session)) {
		return null;
	}
	return typeof session.activeOrganizationId === "string"
		? session.activeOrganizationId
		: null;
}

export interface CliWorkspace {
	readonly id: string;
	readonly slug: string;
	readonly reader: SessionReader;
	readonly workspaceCreatedAt: Date | string | null;
}

export async function resolveCliWorkspace(
	workspace: string | undefined,
	session: unknown,
	userId: string,
	sql: postgres.Sql = sqlClient,
): Promise<CliWorkspace> {
	let requested: string | null = null;
	if (workspace !== undefined) {
		const [named] = await sql<Array<{ id: string }>>`
			SELECT id FROM organization
			WHERE id = ${workspace} OR slug = ${workspace}
			ORDER BY (id = ${workspace}) DESC
			LIMIT 1
		`;
		if (!named)
			throw new ORPCError("FORBIDDEN", {
				message: `Not a member of the workspace ${workspace}`,
			});
		requested = named.id;
	}
	const id = await resolveIngestOrganizationId(
		requested ?? getActiveOrganizationId(session),
		userId,
		sql,
	);
	const member = await readWorkspaceMember(id, userId, sql);
	if (!member)
		throw new ORPCError("FORBIDDEN", {
			message: "Not a member of the specified organization",
		});
	const [organization] = await sql<Array<{ slug: string | null }>>`
		SELECT slug FROM organization WHERE id = ${id} LIMIT 1
	`;
	return {
		id,
		slug: organization?.slug ?? id,
		reader: member.reader,
		workspaceCreatedAt: member.workspaceCreatedAt,
	};
}
