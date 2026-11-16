import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import {
	fetchSelfHostInfo,
	runSelfHostSetup,
	type SelfHostSetupRequest,
} from "./selfhost-api.js";
import type { ServerState } from "./server-state.js";

export interface Reporter {
	readonly info: (line: string) => void;
	readonly warn: (line: string) => void;
}

export type CredentialDecision = "write" | "keep" | "unchanged";

export interface CredentialPromptContext {
	readonly yes: boolean;
	readonly interactive: boolean;
	readonly confirm: (message: string) => Promise<boolean>;
}

export interface AgentSetupResult {
	readonly hooks: readonly {
		readonly agent: "claude_code" | "codex";
		readonly status: string;
	}[];
	readonly mcp: readonly string[];
}

export interface FirstRunResult {
	readonly state: ServerState;
	readonly loginUrl: string | undefined;
	readonly credentials: CredentialDecision;
	readonly created: boolean;
	readonly agents?: AgentSetupResult;
}

export async function runFirstRun(options: {
	readonly state: ServerState;
	readonly localUrl: string;
	readonly email: string | undefined;
	readonly agentSetup: boolean;
	readonly prompt: CredentialPromptContext;
	readonly reporter: Reporter;
}): Promise<FirstRunResult | Error> {
	let state = options.state;
	const info = await fetchSelfHostInfo(options.localUrl);
	if (info === null)
		return new Error(
			`The server at ${options.localUrl} is not running in self-hosted mode (no /api/selfhost/info).`,
		);
	if (state.setup && info.setupComplete)
		return { state, loginUrl: undefined, credentials: "keep", created: false };
	const request = await buildSetupRequest(options.email ?? state.setup?.email);
	const setup = await runSelfHostSetup(
		options.localUrl,
		state.secrets.setupToken,
		request,
	);
	state = {
		...state,
		setup: {
			email: setup.user.email,
			name: setup.user.name,
			userId: setup.user.id,
			organizationId: setup.organization.id,
			organizationSlug: setup.organization.slug,
			organizationName: setup.organization.name,
			apiKey: setup.apiKey,
			apiKeyId: setup.apiKeyId,
			completedAt: new Date().toISOString(),
		},
	};
	options.reporter.info(
		`Created ${setup.user.email} as the admin of workspace ${setup.organization.name}.`,
	);
	return {
		state,
		loginUrl: setup.loginUrl,
		credentials: "keep",
		created: true,
	};
}

export async function buildSetupRequest(
	email: string | undefined,
): Promise<SelfHostSetupRequest> {
	const username = safeUsername();
	const name = (await readGitConfig("user.name")) || username;
	const resolvedEmail =
		email?.trim() ||
		(await readGitConfig("user.email")) ||
		`${username}@opaline.local`;
	return {
		email: resolvedEmail,
		name,
		workspaceName: "Your workspace",
	};
}

function safeUsername(): string {
	try {
		return userInfo().username || "opaline";
	} catch {
		return "opaline";
	}
}

function readGitConfig(key: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["config", "--global", "--get", key],
			{ encoding: "utf8", timeout: 5_000, cwd: homedir() },
			(error, stdout) =>
				resolve(error ? undefined : stdout.trim() || undefined),
		);
	});
}
