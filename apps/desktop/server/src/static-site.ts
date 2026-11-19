import { join, resolve, sep } from "node:path";
import type { FetchHandlerFallbackInput } from "./handler.js";
import {
	getTeamInviteRoute,
	handleTeamInvitePageRequest,
} from "./handlers/team-invite-page-http.js";

export type StaticFallback = (
	input: FetchHandlerFallbackInput,
) => Promise<Response | null>;

export interface StaticSiteOptions {
	readonly directory: string;
	readonly pluginBuildDirectory?: string;
	readonly spaExcludedPrefixes?: readonly string[];
}

export function createStaticFallback(
	options: StaticSiteOptions,
): StaticFallback {
	const directory = resolve(options.directory);
	const excluded = options.spaExcludedPrefixes ?? [];

	return async ({ request, url }) => {
		if (url.pathname.startsWith("/plugin/")) {
			return servePluginAsset(
				directory,
				options.pluginBuildDirectory,
				url.pathname,
			);
		}
		const path = resolve(join(directory, url.pathname));
		if (path.startsWith(`${directory}${sep}`)) {
			const file = Bun.file(path);
			if (await file.exists()) {
				return new Response(file);
			}
		}
		if (excluded.some((prefix) => url.pathname.startsWith(prefix))) {
			return null;
		}

		const indexFile = Bun.file(join(directory, "index.html"));
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
async function servePluginAsset(
	staticDirectory: string,
	pluginBuildDirectory: string | undefined,
	pathname: string,
) {
	const path = pathname.slice("/plugin/".length);
	if (!/^(?:assets\/)?[\w.-]+$/u.test(path)) return null;
	const deployed = Bun.file(join(staticDirectory, pathname));
	const file =
		(await deployed.exists()) || pluginBuildDirectory === undefined
			? deployed
			: Bun.file(join(pluginBuildDirectory, path));
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
