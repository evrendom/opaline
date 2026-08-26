import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import { getPublicWrappedShareForPageMetadata } from "../services/wrapped-share.service.js";
import {
	buildWrappedSharePageMetadata,
	injectWrappedSharePageMetadata,
} from "../services/wrapped-share-page-metadata.js";

const logger = getLogger(["rudel", "api", "wrapped-share-page"]);
const WRAPPED_PUBLIC_PATH_PATTERN = /^\/wrapped\/([A-Za-z0-9_-]+)\/?$/u;

export function getWrappedPublicShareId(pathname: string): string | null {
	return pathname.match(WRAPPED_PUBLIC_PATH_PATTERN)?.[1] ?? null;
}

export async function handleWrappedPublicPageRequest(input: {
	readonly cors: Readonly<Record<string, string>>;
	readonly indexHtml: string;
	readonly request: Request;
	readonly shareId: string;
	readonly source: string;
}): Promise<Response> {
	const { cors, indexHtml, request, shareId, source } = input;
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method not allowed", {
			headers: { ...cors, Allow: "GET, HEAD" },
			status: 405,
		});
	}

	try {
		const share = await getPublicWrappedShareForPageMetadata(shareId, source);
		if (!share) {
			return htmlResponse(request.method, indexHtml, cors);
		}

		const requestUrl = new URL(request.url);
		const publicOrigin = getPublicRequestOrigin(request, requestUrl);
		const publicUrl = new URL(requestUrl.pathname, publicOrigin).toString();
		const html = injectWrappedSharePageMetadata(
			indexHtml,
			buildWrappedSharePageMetadata({
				...(share.hasSocialImage
					? {
							imageUrl: buildWrappedShareCardImageUrl({
								publicOrigin,
								requestPathname: requestUrl.pathname,
								share,
							}),
						}
					: {}),
				publicUrl,
				share,
			}),
		);

		return htmlResponse(request.method, html, cors);
	} catch (error) {
		if (error instanceof ORPCError && error.code === "TOO_MANY_REQUESTS") {
			return new Response("Too many requests", {
				headers: cors,
				status: 429,
			});
		}

		logger.error("Failed to inject wrapped share metadata: {error}", {
			error: String(error),
		});
		return htmlResponse(request.method, indexHtml, cors);
	}
}

function htmlResponse(
	method: string,
	html: string,
	cors: Readonly<Record<string, string>>,
): Response {
	return new Response(method === "HEAD" ? null : html, {
		headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
	});
}

function buildWrappedShareCardImageUrl(input: {
	readonly publicOrigin: string;
	readonly requestPathname: string;
	readonly share: { readonly expires_at: string };
}): string {
	const { publicOrigin, requestPathname, share } = input;
	const imageUrl = new URL(
		`${requestPathname.replace(/\/$/u, "")}/x-card.png`,
		publicOrigin,
	);
	const imageVersion = getWrappedShareImageVersion(share.expires_at);

	if (imageVersion) {
		imageUrl.searchParams.set("v", imageVersion);
	}

	return imageUrl.toString();
}

function getWrappedShareImageVersion(expiresAt: string): string | undefined {
	const timestamp = Date.parse(expiresAt);
	return Number.isFinite(timestamp)
		? Math.floor(timestamp / 1000).toString(36)
		: undefined;
}

function getPublicRequestOrigin(request: Request, url: URL): string {
	const forwardedProto = request.headers.get("x-forwarded-proto");
	const forwardedHost = request.headers.get("x-forwarded-host");
	const proto =
		forwardedProto?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
	const host =
		forwardedHost?.split(",")[0]?.trim() ||
		request.headers.get("host") ||
		url.host;

	return `${proto}://${host}`;
}
