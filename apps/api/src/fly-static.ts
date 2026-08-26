import { join } from "node:path";
import type { FetchHandlerFallbackInput } from "./handler.js";
import {
	getWrappedPublicShareId,
	handleWrappedPublicPageRequest,
} from "./handlers/wrapped-share-page-http.js";

export type FlyStaticFallback = (
	input: FetchHandlerFallbackInput,
) => Promise<Response | null>;

export function createFlyStaticFallback(): FlyStaticFallback {
	const staticDirectory = join(
		import.meta.dir,
		"..",
		process.env.STATIC_DIR ?? "public",
	);

	return async ({ cors, request, url, wrappedShareLookupSource }) => {
		const file = Bun.file(join(staticDirectory, url.pathname));
		if (await file.exists()) {
			return new Response(file);
		}

		const indexFile = Bun.file(join(staticDirectory, "index.html"));
		if (!(await indexFile.exists())) {
			return null;
		}

		const shareId = getWrappedPublicShareId(url.pathname);
		if (!shareId) {
			return new Response(indexFile);
		}

		return handleWrappedPublicPageRequest({
			cors,
			indexHtml: await indexFile.text(),
			request,
			shareId,
			source: wrappedShareLookupSource,
		});
	};
}
