import { join } from "node:path";
import type { FetchHandlerFallbackInput } from "./handler.js";
import {
	getTeamInviteRoute,
	handleTeamInvitePageRequest,
} from "./handlers/team-invite-page-http.js";

export type FlyStaticFallback = (
	input: FetchHandlerFallbackInput,
) => Promise<Response | null>;

export function createFlyStaticFallback(): FlyStaticFallback {
	const staticDirectory = join(
		import.meta.dir,
		"..",
		process.env.STATIC_DIR ?? "public",
	);

	return async ({ request, url }) => {
		const file = Bun.file(join(staticDirectory, url.pathname));
		if (await file.exists()) {
			return new Response(file);
		}

		const indexFile = Bun.file(join(staticDirectory, "index.html"));
		if (!(await indexFile.exists())) {
			return null;
		}

		const invite = getTeamInviteRoute(url.pathname);
		if (invite && !invite.image) {
			return handleTeamInvitePageRequest({
				request,
				token: invite.token,
				indexHtml: await indexFile.text(),
			});
		}
		return new Response(indexFile);
	};
}
