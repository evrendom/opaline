import type postgres from "postgres";
import {
	assertGitHubRepositoryEvidencePermissions,
	createGitHubUserAuthorizationUrl,
	exchangeGitHubUserAuthorizationCode,
	listGitHubUserInstallationRepositories,
	readGitHubInstallation,
	readGitHubInstallationStateSecret,
	readGitHubRepositoryAppConfig,
	readGitHubRepositoryAppUserAuthorizationConfig,
	verifyGitHubInstallState,
	verifyGitHubUserAuthorizationState,
} from "../services/github-app.service.js";
import {
	GitHubInstallationAlreadyBoundError,
	persistGitHubRepositoryInstallation,
} from "../services/github-repository-binding.service.js";

export type GitHubSettingsConnectionResult =
	| "cancelled"
	| "connected"
	| "error"
	| "forbidden"
	| "already-connected"
	| "session-required";

export function createGitHubSettingsRedirect(input: {
	readonly frontendOrigin: string;
	readonly result: GitHubSettingsConnectionResult;
	readonly workspaceSlug: string;
	readonly returnTo?: "settings" | "onboarding";
}): Response {
	const destination = new URL(
		input.returnTo === "onboarding"
			? "/welcome"
			: `/${encodeURIComponent(input.workspaceSlug)}/settings/github`,
		input.frontendOrigin,
	);
	destination.searchParams.set("github", input.result);
	return new Response(null, {
		headers: {
			"Cache-Control": "private, no-store",
			Location: destination.toString(),
		},
		status: 302,
	});
}

export async function handleGitHubRepositorySetupRequest(input: {
	readonly database: postgres.Sql;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly fetch?: typeof globalThis.fetch;
	readonly frontendOrigin: string;
	readonly getSession: (
		request: Request,
	) => Promise<{ readonly user: { readonly id: string } } | null>;
	readonly request: Request;
}): Promise<Response> {
	if (input.request.method !== "GET") {
		return new Response("Method not allowed", {
			headers: { Allow: "GET" },
			status: 405,
		});
	}
	const url = new URL(input.request.url);
	const stateValue = url.searchParams.get("state");
	if (!stateValue) {
		return new Response("Invalid GitHub installation callback.", {
			status: 400,
		});
	}
	let stateSecret: string;
	try {
		stateSecret = readGitHubInstallationStateSecret(input.environment);
	} catch {
		return new Response("Invalid or expired GitHub installation state.", {
			status: 400,
		});
	}
	let installState: ReturnType<typeof verifyGitHubInstallState> | null = null;
	let authorizationState: ReturnType<
		typeof verifyGitHubUserAuthorizationState
	> | null = null;
	try {
		authorizationState = verifyGitHubUserAuthorizationState({
			state: stateValue,
			stateSecret,
		});
	} catch {
		try {
			installState = verifyGitHubInstallState({
				state: stateValue,
				stateSecret,
			});
		} catch {
			return new Response("Invalid or expired GitHub installation state.", {
				status: 400,
			});
		}
	}
	const state = authorizationState ?? installState;
	if (!state) {
		return new Response("Invalid or expired GitHub installation state.", {
			status: 400,
		});
	}
	const redirect = (result: GitHubSettingsConnectionResult) =>
		createGitHubSettingsRedirect({
			returnTo: state.returnTo,
			frontendOrigin: input.frontendOrigin,
			result,
			workspaceSlug: state.workspaceSlug,
		});
	const session = await input.getSession(input.request);
	if (!session) return redirect("session-required");
	if (state.userId !== session.user.id) {
		return redirect("forbidden");
	}
	const memberships = await input.database.unsafe<Array<{ slug: string }>>(
		"SELECT organization.slug FROM member INNER JOIN organization ON organization.id = member.organization_id WHERE member.organization_id = $1 AND member.user_id = $2 AND member.role IN ('owner', 'admin') AND organization.slug = $3 LIMIT 1",
		[state.organizationId, session.user.id, state.workspaceSlug],
	);
	if (!memberships[0]) {
		return redirect("forbidden");
	}
	const providerError = url.searchParams.get("error");
	if (providerError) {
		return redirect(providerError === "access_denied" ? "cancelled" : "error");
	}
	let config: ReturnType<typeof readGitHubRepositoryAppConfig>;
	let userAuthorizationConfig: ReturnType<
		typeof readGitHubRepositoryAppUserAuthorizationConfig
	>;
	try {
		config = readGitHubRepositoryAppConfig(input.environment);
		userAuthorizationConfig = readGitHubRepositoryAppUserAuthorizationConfig(
			input.environment,
		);
	} catch {
		return redirect("error");
	}
	if (!config || !userAuthorizationConfig) return redirect("error");
	if (installState) {
		const installationId = url.searchParams.get("installation_id");
		const setupAction = url.searchParams.get("setup_action");
		if (!installationId || !["install", "update"].includes(setupAction ?? "")) {
			return redirect("error");
		}
		let authorizationUrl: string;
		try {
			authorizationUrl = createGitHubUserAuthorizationUrl({
				returnTo: installState.returnTo,
				config: userAuthorizationConfig,
				installationId,
				organizationId: installState.organizationId,
				stateSecret,
				userId: installState.userId,
				workspaceSlug: installState.workspaceSlug,
			});
		} catch {
			return redirect("error");
		}
		return new Response(null, {
			headers: {
				"Cache-Control": "private, no-store",
				Location: authorizationUrl,
			},
			status: 302,
		});
	}
	if (!authorizationState) return redirect("error");
	const code = url.searchParams.get("code");
	if (!code) return redirect("error");
	try {
		const userToken = await exchangeGitHubUserAuthorizationCode({
			fetch: input.fetch,
			code,
			config: userAuthorizationConfig,
			state: stateValue,
			stateSecret,
		});
		const repositories = await listGitHubUserInstallationRepositories({
			fetch: input.fetch,
			installationId: authorizationState.installationId,
			token: userToken,
		});
		const details = await readGitHubInstallation({
			fetch: input.fetch,
			config,
			installationId: authorizationState.installationId,
		});
		assertGitHubRepositoryEvidencePermissions(details.permissions);
		await persistGitHubRepositoryInstallation({
			database: input.database,
			details,
			installedByUserId: session.user.id,
			now: new Date(),
			organizationId: state.organizationId,
			repositories,
		});
	} catch (error) {
		if (error instanceof GitHubInstallationAlreadyBoundError)
			return redirect("already-connected");
		return redirect("error");
	}
	return redirect("connected");
}
