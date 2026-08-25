import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FetchHandlerFallbackInput } from "./handler.js";
import {
	getWrappedPublicShareId,
	handleWrappedPublicPageRequest,
} from "./handlers/wrapped-share-page-http.js";

const SPA_INDEX_PATH = resolve(process.cwd(), "apps/web/dist/index.html");
let indexHtmlPromise: Promise<string> | undefined;

export async function handleVercelWrappedFallback(
	input: FetchHandlerFallbackInput,
): Promise<Response | null> {
	const shareId = getWrappedPublicShareId(input.url.pathname);
	if (!shareId) {
		return null;
	}

	indexHtmlPromise ??= readFile(SPA_INDEX_PATH, "utf8");
	return handleWrappedPublicPageRequest({
		cors: input.cors,
		indexHtml: await indexHtmlPromise,
		request: input.request,
		shareId,
		source: input.wrappedShareLookupSource,
	});
}
