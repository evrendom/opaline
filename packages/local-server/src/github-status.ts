import { join } from "node:path";
import { z } from "zod";
import { sanitizeForTerminalDisplay } from "./safe-url.js";

const GitHubStatusSchema = z.object({
	state: z.enum(["ready", "missing", "rejected", "unreachable"]),
	source: z.enum(["GITHUB_TOKEN", "GH_TOKEN", "gh"]).nullable(),
	host: z.string(),
	login: z.string().nullable(),
	scopes: z.array(z.string()).nullable(),
	missingScopes: z.array(z.string()),
	message: z.string().nullable(),
	fix: z.string().nullable(),
	repositories: z.number().int().nonnegative(),
	unreadableRepositories: z.array(z.string()),
	pausedUntil: z.string().nullable(),
});

export type SelfHostGitHubStatus = z.infer<typeof GitHubStatusSchema>;

const LABEL = "  GitHub      ";
const INDENT = "              ";

export async function fetchSelfHostGitHubStatus(
	localUrl: string,
	setupToken: string,
	fetchImpl: typeof fetch = fetch,
): Promise<SelfHostGitHubStatus | null> {
	const response = await fetchImpl(
		`${localUrl.replace(/\/+$/u, "")}/api/selfhost/github`,
		{
			headers: { "X-Opaline-Setup-Token": setupToken },
			signal: AbortSignal.timeout(20_000),
		},
	);
	if (response.status === 404) return null;
	if (!response.ok)
		throw new Error(`the server answered HTTP ${response.status}`);
	const parsed = z
		.object({ github: GitHubStatusSchema })
		.safeParse(await response.json().catch(() => null));
	if (!parsed.success) throw new Error("the server's answer has another shape");
	return parsed.data.github;
}

export function describeGitHubStatus(
	status: SelfHostGitHubStatus | null,
	dataDir: string,
): string[] {
	if (status === null)
		return [`${LABEL}this server version does not report its GitHub status`];
	if (status.state !== "ready") {
		const lines = [
			`${LABEL}${status.state === "missing" ? "not signed in" : status.state}: ${show(status.message ?? "no token")}`,
		];
		if (status.fix)
			lines.push(
				`${INDENT}Fix: ${show(status.fix)} where the server runs (no restart needed),`,
				`${INDENT}or put GITHUB_TOKEN=<token> in ${join(dataDir, "server.env")} and run \`opaline server stop && opaline server\`.`,
			);
		return lines;
	}
	const via =
		status.source === "gh"
			? `signed in via gh as ${show(status.login ?? "?")}`
			: `token from ${status.source} for ${show(status.login ?? "?")}`;
	const scopes =
		status.scopes === null
			? "fine-grained token"
			: `scopes ${status.scopes.join(", ") || "none"}`;
	const lines = [
		`${LABEL}${via} on ${show(status.host)} (${show(scopes)}); ${status.repositories} ${status.repositories === 1 ? "repository" : "repositories"} collected`,
	];
	if (status.missingScopes.length > 0)
		lines.push(
			`${INDENT}${show(status.message ?? "The token has no repo scope.")}${status.fix ? ` Fix: ${show(status.fix)}` : ""}`,
		);
	if (status.unreadableRepositories.length > 0)
		lines.push(
			`${INDENT}Not readable with this token: ${show(status.unreadableRepositories.slice(0, 5).join(", "))}${status.unreadableRepositories.length > 5 ? ` and ${status.unreadableRepositories.length - 5} more` : ""}`,
		);
	if (status.pausedUntil)
		lines.push(
			`${INDENT}Waiting for the GitHub rate limit until ${show(status.pausedUntil)}`,
		);
	return lines;
}

export async function readGitHubStatusLines(
	localUrl: string,
	setupToken: string,
	dataDir: string,
	fetchImpl?: typeof fetch,
): Promise<string[]> {
	try {
		return describeGitHubStatus(
			await fetchSelfHostGitHubStatus(localUrl, setupToken, fetchImpl),
			dataDir,
		);
	} catch (error) {
		return [
			`${LABEL}status unavailable (${show(error instanceof Error ? error.message : String(error))})`,
		];
	}
}

function show(text: string): string {
	return sanitizeForTerminalDisplay(text);
}
