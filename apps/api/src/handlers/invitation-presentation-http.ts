import type { Session as AuthSession } from "../auth.js";
import { sqlClient } from "../db.js";

type SessionResolver = (request: Request) => Promise<AuthSession | null>;

export async function handleInvitationPresentationRequest(input: {
	cors: Readonly<Record<string, string>>;
	getSession: SessionResolver;
	invitationId: string;
	request: Request;
}): Promise<Response> {
	const { cors, getSession, invitationId, request } = input;
	if (request.method !== "GET") {
		return new Response("Method Not Allowed", {
			headers: { ...cors, Allow: "GET" },
			status: 405,
		});
	}

	const session = await getSession(request);
	if (!session) {
		return Response.json(
			{ error: "Unauthorized" },
			{ headers: cors, status: 401 },
		);
	}

	const [invitation] = await sqlClient<
		Array<{
			inviterImage: string | null;
			inviterName: string;
			organizationName: string;
		}>
	>`
		SELECT
			inviter.image AS "inviterImage",
			inviter.name AS "inviterName",
			organization.name AS "organizationName"
		FROM invitation
		INNER JOIN organization
			ON organization.id = invitation.organization_id
		INNER JOIN "user" inviter
			ON inviter.id = invitation.inviter_id
		WHERE invitation.id = ${invitationId}
			AND LOWER(invitation.email) = LOWER(${session.user.email})
			AND invitation.status = 'pending'
			AND invitation.expires_at > NOW()
		LIMIT 1
	`;

	if (!invitation) {
		return Response.json(
			{ error: "Invitation not found or no longer available" },
			{ headers: cors, status: 404 },
		);
	}

	return Response.json(
		{
			inviter: {
				image: invitation.inviterImage,
				name: invitation.inviterName,
			},
			organizationName: invitation.organizationName,
		},
		{ headers: cors },
	);
}
