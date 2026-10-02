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
		if (url.pathname.startsWith("/plugin/")) {
			return servePluginAsset(staticDirectory, url.pathname);
		}
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

// The plugin app runs on the host's sandbox origin, so its files need CORS.
// Hashed chunks never change; the entry and images revalidate on every load,
// so an app reopened after a deploy never pairs stale files.
async function servePluginAsset(staticDirectory: string, pathname: string) {
	const path = pathname.slice("/plugin/".length);
	if (!/^(?:assets\/)?[\w.-]+$/u.test(path)) return null;
	const deployed = Bun.file(join(staticDirectory, pathname));
	const file = (await deployed.exists())
		? deployed
		: Bun.file(join(import.meta.dir, "../../web/dist-plugin", path));
	if (!(await file.exists())) return null;
	return new Response(file, {
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Cache-Control": path.startsWith("assets/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
		},
	});
}
