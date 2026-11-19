import { getFrontendOrigin } from "../frontend-origin.js";
import { injectSocialPageMetadata } from "../services/social-page-metadata.js";
import {
	renderTeamInviteCardPng,
	TEAM_INVITE_IMAGE_HEIGHT,
	TEAM_INVITE_IMAGE_WIDTH,
	teamInviteCardImageAvailable,
} from "../services/team-invite-card-image.js";
import { getTeamInviteLinkPreview } from "../services/team-invite-link.service.js";

export function getTeamInviteRoute(pathname: string) {
	const match =
		/^\/(?:[^/]+\/join|team\/invite)\/([A-Za-z0-9_-]{1,256})(\/og\.png)?\/?$/u.exec(
			pathname,
		);
	const token = match?.[1];
	return token ? { token, image: Boolean(match?.[2]) } : null;
}

export async function handleTeamInvitePageRequest(input: {
	request: Request;
	indexHtml: string;
	token: string;
}): Promise<Response> {
	const { request, indexHtml, token } = input;
	if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed();
	const [workspace, imageAvailable] = await Promise.all([
		getTeamInviteLinkPreview(token),
		teamInviteCardImageAvailable(),
	]);
	const origin = getFrontendOrigin();
	const path = workspace
		? `/${encodeURIComponent(workspace.slug)}/join/${encodeURIComponent(token)}`
		: new URL(request.url).pathname;
	const publicUrl = new URL(path, origin).toString();
	const imageUrl = `${publicUrl}/og.png`;
	const description = workspace
		? `Join ${workspace.name} and start learning from your agent sessions`
		: "This workspace invitation is no longer available.";
	const html = injectSocialPageMetadata(
		indexHtml.replace(
			/<meta\s+name=["']robots["'][^>]*>\s*|<link\s+rel=["']canonical["'][^>]*>\s*/giu,
			"",
		),
		{
			title: workspace
				? `Join ${workspace.name} | Opaline`
				: "Workspace invitation | Opaline",
			description,
			publicUrl,
			...(workspace && imageAvailable
				? {
						imageUrl,
						imageAlt: description,
						imageWidth: TEAM_INVITE_IMAGE_WIDTH,
						imageHeight: TEAM_INVITE_IMAGE_HEIGHT,
						imageType: "image/png",
						...(imageUrl.startsWith("https:")
							? { imageSecureUrl: imageUrl }
							: {}),
					}
				: {}),
		},
	).replace(
		"</head>",
		`<link rel="canonical" href="${publicUrl}" /><meta name="robots" content="noindex" /></head>`,
	);
	return new Response(request.method === "HEAD" ? null : html, {
		status: workspace ? 200 : 404,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Robots-Tag": "noindex",
			"Referrer-Policy": "no-referrer",
		},
	});
}

export async function handleTeamInviteImageRequest(
	request: Request,
	token: string,
): Promise<Response> {
	if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed();
	const workspace = await getTeamInviteLinkPreview(token);
	if (!workspace)
		return new Response("Invitation not found", {
			status: 404,
			headers: { "Cache-Control": "no-store" },
		});
	if (!(await teamInviteCardImageAvailable()))
		return new Response("Invitation image unavailable", {
			status: 404,
			headers: { "Cache-Control": "no-store" },
		});
	return new Response(
		request.method === "HEAD"
			? null
			: await renderTeamInviteCardPng(workspace.name),
		{
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=300, must-revalidate",
				"X-Robots-Tag": "noindex",
			},
		},
	);
}

function methodNotAllowed(): Response {
	return new Response("Method not allowed", {
		status: 405,
		headers: { Allow: "GET, HEAD" },
	});
}
