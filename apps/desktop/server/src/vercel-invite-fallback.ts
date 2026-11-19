import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FetchHandlerFallbackInput } from "./handler.js";
import {
	getTeamInviteRoute,
	handleTeamInvitePageRequest,
} from "./handlers/team-invite-page-http.js";

const SPA_INDEX_PATH = resolve(
	process.cwd(),
	"apps/desktop/ui/dist/index.html",
);
let indexHtmlPromise: Promise<string> | undefined;

export async function handleVercelInviteFallback(
	input: FetchHandlerFallbackInput,
): Promise<Response | null> {
	const invite = getTeamInviteRoute(input.url.pathname);
	if (!invite) {
		return null;
	}

	indexHtmlPromise ??= readFile(SPA_INDEX_PATH, "utf8");
	return handleTeamInvitePageRequest({
		request: input.request,
		token: invite.token,
		indexHtml: await indexHtmlPromise,
	});
}
