import {
	createHash,
	createHmac,
	createPrivateKey,
	createPublicKey,
	randomBytes,
	sign,
	timingSafeEqual,
	verify,
} from "node:crypto";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const INSTALL_STATE_VERSION = 2;
const INSTALL_STATE_TTL_SECONDS = 15 * 60;
const REQUIRED_REPOSITORY_EVIDENCE_PERMISSIONS = [
	"actions",
	"checks",
	"contents",
	"metadata",
	"pull_requests",
	"statuses",
] as const;

export interface GitHubRepositoryAppConfig {
	readonly appId: string;
	readonly privateKeyPem: string;
	readonly slug: string;
}

export interface GitHubRepositoryAppUserAuthorizationConfig {
	readonly callbackUrl: string;
	readonly clientId: string;
	readonly clientSecret: string;
}

export interface GitHubInstallState {
	readonly organizationId: string;
	readonly userId: string;
	readonly workspaceSlug: string;
}

export interface GitHubUserAuthorizationState extends GitHubInstallState {
	readonly installationId: string;
}

export interface GitHubInstallationRepository {
	readonly defaultBranch: string;
	readonly fullName: string;
	readonly id: string;
	readonly isPrivate: boolean;
	readonly name: string;
	readonly nodeId: string;
	readonly owner: string;
}

export interface GitHubInstallationDetails {
	readonly accountId: string;
	readonly accountLogin: string;
	readonly accountType: "Organization" | "User";
	readonly installationId: string;
	readonly permissions: Readonly<Record<string, string>>;
	readonly repositorySelection: "all" | "selected";
}

export function readGitHubRepositoryAppConfig(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): GitHubRepositoryAppConfig | null {
	const appId = environment.GITHUB_REPOSITORY_APP_ID?.trim();
	const slug = environment.GITHUB_REPOSITORY_APP_SLUG?.trim();
	const rawPrivateKey = environment.GITHUB_REPOSITORY_APP_PRIVATE_KEY?.trim();
	if (!appId && !slug && !rawPrivateKey) return null;
	if (!appId || !/^[1-9][0-9]*$/u.test(appId)) {
		throw new Error(
			"GITHUB_REPOSITORY_APP_ID must be a positive integer string",
		);
	}
	if (!slug || !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(slug)) {
		throw new Error("GITHUB_REPOSITORY_APP_SLUG is invalid");
	}
	if (!rawPrivateKey) {
		throw new Error("GITHUB_REPOSITORY_APP_PRIVATE_KEY is required");
	}
	const privateKeyPem = rawPrivateKey.replace(/\\n/gu, "\n");
	createPrivateKey(privateKeyPem);
	return { appId, privateKeyPem, slug };
}

export function readGitHubRepositoryAppUserAuthorizationConfig(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): GitHubRepositoryAppUserAuthorizationConfig | null {
	const clientId = environment.GITHUB_REPOSITORY_APP_CLIENT_ID?.trim();
	const clientSecret = environment.GITHUB_REPOSITORY_APP_CLIENT_SECRET?.trim();
	const callbackUrl = environment.GITHUB_REPOSITORY_APP_CALLBACK_URL?.trim();
	if (!clientId && !clientSecret && !callbackUrl) return null;
	if (!clientId) {
		throw new Error("GITHUB_REPOSITORY_APP_CLIENT_ID is required");
	}
	if (!clientSecret) {
		throw new Error("GITHUB_REPOSITORY_APP_CLIENT_SECRET is required");
	}
	if (!callbackUrl) {
		throw new Error("GITHUB_REPOSITORY_APP_CALLBACK_URL is required");
	}
	const parsedCallbackUrl = new URL(callbackUrl);
	const isLoopbackHttp =
		parsedCallbackUrl.protocol === "http:" &&
		["127.0.0.1", "::1", "localhost"].includes(parsedCallbackUrl.hostname);
	if (parsedCallbackUrl.protocol !== "https:" && !isLoopbackHttp) {
		throw new Error(
			"GITHUB_REPOSITORY_APP_CALLBACK_URL must use HTTPS or loopback HTTP",
		);
	}
	if (parsedCallbackUrl.username || parsedCallbackUrl.password) {
		throw new Error(
			"GITHUB_REPOSITORY_APP_CALLBACK_URL must not contain credentials",
		);
	}
	if (
		parsedCallbackUrl.pathname !== "/api/github/setup" ||
		parsedCallbackUrl.search ||
		parsedCallbackUrl.hash
	) {
		throw new Error(
			"GITHUB_REPOSITORY_APP_CALLBACK_URL must end at /api/github/setup",
		);
	}
	return {
		callbackUrl: parsedCallbackUrl.toString(),
		clientId,
		clientSecret,
	};
}

export function readGitHubInstallationStateSecret(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
	const secret =
		environment.GITHUB_REPOSITORY_APP_STATE_SECRET?.trim() ||
		environment.BETTER_AUTH_SECRET?.trim();
	if (!secret || secret.length < 32) {
		throw new Error(
			"GITHUB_REPOSITORY_APP_STATE_SECRET or BETTER_AUTH_SECRET must contain at least 32 characters",
		);
	}
	return secret;
}

export function assertGitHubRepositoryEvidencePermissions(
	permissions: Readonly<Record<string, string>>,
): void {
	const missing = REQUIRED_REPOSITORY_EVIDENCE_PERMISSIONS.filter(
		(permission) =>
			permissions[permission] !== "read" && permissions[permission] !== "write",
	);
	if (missing.length > 0) {
		throw new Error(
			`GitHub App is missing repository evidence permission(s): ${missing.join(", ")}`,
		);
	}
}

export function createGitHubAppJwt(
	config: GitHubRepositoryAppConfig,
	now = new Date(),
): string {
	const issuedAt = Math.floor(now.getTime() / 1000) - 30;
	const header = encodeJson({ alg: "RS256", typ: "JWT" });
	const payload = encodeJson({
		exp: issuedAt + 9 * 60,
		iat: issuedAt,
		iss: config.appId,
	});
	const signingInput = `${header}.${payload}`;
	const signature = sign(
		"RSA-SHA256",
		Buffer.from(signingInput),
		createPrivateKey(config.privateKeyPem),
	).toString("base64url");
	return `${signingInput}.${signature}`;
}

export function verifyGitHubAppJwtForTests(
	jwt: string,
	privateKeyPem: string,
): boolean {
	const [header, payload, signature, extra] = jwt.split(".");
	if (!header || !payload || !signature || extra !== undefined) return false;
	return verify(
		"RSA-SHA256",
		Buffer.from(`${header}.${payload}`),
		createPublicKey(createPrivateKey(privateKeyPem)),
		Buffer.from(signature, "base64url"),
	);
}

export function createGitHubInstallationUrl(input: {
	readonly config: GitHubRepositoryAppConfig;
	readonly organizationId: string;
	readonly stateSecret: string;
	readonly userId: string;
	readonly workspaceSlug: string;
	readonly now?: Date;
	readonly nonce?: string;
}): string {
	const state = createGitHubInstallState({
		organizationId: input.organizationId,
		stateSecret: input.stateSecret,
		userId: input.userId,
		workspaceSlug: input.workspaceSlug,
		now: input.now,
		nonce: input.nonce,
	});
	const url = new URL(
		`https://github.com/apps/${encodeURIComponent(input.config.slug)}/installations/new`,
	);
	url.searchParams.set("state", state);
	return url.toString();
}

export function createGitHubInstallState(input: {
	readonly organizationId: string;
	readonly stateSecret: string;
	readonly userId: string;
	readonly workspaceSlug: string;
	readonly now?: Date;
	readonly nonce?: string;
}): string {
	if (input.stateSecret.length < 32) {
		throw new Error("GitHub installation state secret is too short");
	}
	const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
	const encoded = encodeJson({
		exp: nowSeconds + INSTALL_STATE_TTL_SECONDS,
		iat: nowSeconds,
		nonce: input.nonce ?? randomBytes(18).toString("base64url"),
		organizationId: input.organizationId,
		phase: "install",
		userId: input.userId,
		version: INSTALL_STATE_VERSION,
		workspaceSlug: input.workspaceSlug,
	});
	return `${encoded}.${stateSignature(encoded, input.stateSecret)}`;
}

export function createGitHubUserAuthorizationUrl(input: {
	readonly config: GitHubRepositoryAppUserAuthorizationConfig;
	readonly installationId: string;
	readonly organizationId: string;
	readonly stateSecret: string;
	readonly userId: string;
	readonly workspaceSlug: string;
	readonly now?: Date;
	readonly nonce?: string;
}): string {
	const state = createGitHubUserAuthorizationState(input);
	const codeVerifier = deriveGitHubPkceVerifier(state, input.stateSecret);
	const url = new URL("https://github.com/login/oauth/authorize");
	url.searchParams.set("client_id", input.config.clientId);
	url.searchParams.set("redirect_uri", input.config.callbackUrl);
	url.searchParams.set("state", state);
	url.searchParams.set(
		"code_challenge",
		createHash("sha256").update(codeVerifier).digest("base64url"),
	);
	url.searchParams.set("code_challenge_method", "S256");
	return url.toString();
}

export function createGitHubUserAuthorizationState(input: {
	readonly installationId: string;
	readonly organizationId: string;
	readonly stateSecret: string;
	readonly userId: string;
	readonly workspaceSlug: string;
	readonly now?: Date;
	readonly nonce?: string;
}): string {
	assertInstallationId(input.installationId);
	if (input.stateSecret.length < 32) {
		throw new Error("GitHub installation state secret is too short");
	}
	const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
	const encoded = encodeJson({
		exp: nowSeconds + INSTALL_STATE_TTL_SECONDS,
		iat: nowSeconds,
		installationId: input.installationId,
		nonce: input.nonce ?? randomBytes(18).toString("base64url"),
		organizationId: input.organizationId,
		phase: "authorize",
		userId: input.userId,
		version: INSTALL_STATE_VERSION,
		workspaceSlug: input.workspaceSlug,
	});
	return `${encoded}.${stateSignature(encoded, input.stateSecret)}`;
}

export function verifyGitHubInstallState(input: {
	readonly now?: Date;
	readonly state: string;
	readonly stateSecret: string;
}): GitHubInstallState {
	const value = verifyStatePayload(input);
	if (!isInstallStatePayload(value)) {
		throw new Error("GitHub installation state payload is invalid");
	}
	return {
		organizationId: value.organizationId,
		userId: value.userId,
		workspaceSlug: value.workspaceSlug,
	};
}

export function verifyGitHubUserAuthorizationState(input: {
	readonly now?: Date;
	readonly state: string;
	readonly stateSecret: string;
}): GitHubUserAuthorizationState {
	const value = verifyStatePayload(input);
	if (!isUserAuthorizationStatePayload(value)) {
		throw new Error("GitHub user authorization state payload is invalid");
	}
	return {
		installationId: value.installationId,
		organizationId: value.organizationId,
		userId: value.userId,
		workspaceSlug: value.workspaceSlug,
	};
}

export async function exchangeGitHubUserAuthorizationCode(input: {
	readonly code: string;
	readonly config: GitHubRepositoryAppUserAuthorizationConfig;
	readonly fetch?: typeof globalThis.fetch;
	readonly state: string;
	readonly stateSecret: string;
}): Promise<string> {
	if (!input.code) throw new Error("GitHub user authorization code is missing");
	const body = new URLSearchParams({
		client_id: input.config.clientId,
		client_secret: input.config.clientSecret,
		code: input.code,
		code_verifier: deriveGitHubPkceVerifier(input.state, input.stateSecret),
		redirect_uri: input.config.callbackUrl,
	});
	const response = await (input.fetch ?? globalThis.fetch)(
		"https://github.com/login/oauth/access_token",
		{
			body,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": "opaline-repository-evidence/1",
			},
			method: "POST",
		},
	);
	if (!response.ok) {
		throw new Error(
			`GitHub user authorization failed with HTTP ${response.status}`,
		);
	}
	const value: unknown = await response.json();
	if (
		!isRecord(value) ||
		typeof value.access_token !== "string" ||
		!value.access_token ||
		value.token_type !== "bearer"
	) {
		throw new Error("GitHub did not return a user access token");
	}
	return value.access_token;
}

export async function listGitHubUserInstallationRepositories(input: {
	readonly fetch?: typeof globalThis.fetch;
	readonly installationId: string;
	readonly token: string;
}): Promise<readonly GitHubInstallationRepository[]> {
	assertInstallationId(input.installationId);
	const repositories: GitHubInstallationRepository[] = [];
	for (let page = 1; ; page += 1) {
		const response = await githubFetch(
			`/user/installations/${input.installationId}/repositories?per_page=100&page=${page}`,
			{
				authorization: `Bearer ${input.token}`,
				fetch: input.fetch,
				method: "GET",
			},
		);
		const value: unknown = await response.json();
		if (
			!isRecord(value) ||
			!Number.isSafeInteger(value.total_count) ||
			!Array.isArray(value.repositories)
		) {
			throw new Error(
				"GitHub returned an invalid user installation repository list",
			);
		}
		for (const repository of value.repositories) {
			repositories.push(parseGitHubInstallationRepository(repository));
		}
		if (value.repositories.length < 100) break;
		if (page >= 100) {
			throw new Error("GitHub repository pagination exceeded 100 pages");
		}
	}
	return repositories;
}

export async function createGitHubInstallationAccessToken(input: {
	readonly config: GitHubRepositoryAppConfig;
	readonly fetch?: typeof globalThis.fetch;
	readonly installationId: string;
	readonly now?: Date;
}): Promise<string> {
	assertInstallationId(input.installationId);
	const response = await githubFetch(
		`/app/installations/${input.installationId}/access_tokens`,
		{
			authorization: `Bearer ${createGitHubAppJwt(input.config, input.now)}`,
			fetch: input.fetch,
			method: "POST",
		},
	);
	const value: unknown = await response.json();
	if (!isRecord(value) || typeof value.token !== "string" || !value.token) {
		throw new Error("GitHub did not return an installation access token");
	}
	return value.token;
}

export async function readGitHubInstallation(input: {
	readonly config: GitHubRepositoryAppConfig;
	readonly fetch?: typeof globalThis.fetch;
	readonly installationId: string;
	readonly now?: Date;
}): Promise<GitHubInstallationDetails> {
	assertInstallationId(input.installationId);
	const response = await githubFetch(
		`/app/installations/${input.installationId}`,
		{
			authorization: `Bearer ${createGitHubAppJwt(input.config, input.now)}`,
			fetch: input.fetch,
			method: "GET",
		},
	);
	const value: unknown = await response.json();
	if (!isRecord(value) || !isRecord(value.account)) {
		throw new Error("GitHub returned an invalid installation");
	}
	const accountType = value.account.type;
	const selection = value.repository_selection;
	if (
		(accountType !== "Organization" && accountType !== "User") ||
		(selection !== "all" && selection !== "selected") ||
		typeof value.account.id !== "number" ||
		typeof value.account.login !== "string" ||
		!isRecord(value.permissions)
	) {
		throw new Error("GitHub returned an invalid installation");
	}
	return {
		accountId: String(value.account.id),
		accountLogin: value.account.login,
		accountType,
		installationId: input.installationId,
		permissions: Object.fromEntries(
			Object.entries(value.permissions).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
		repositorySelection: selection,
	};
}

function parseGitHubInstallationRepository(
	value: unknown,
): GitHubInstallationRepository {
	if (!isRecord(value) || !isRecord(value.owner)) {
		throw new Error("GitHub returned an invalid installation repository");
	}
	if (
		typeof value.id !== "number" ||
		typeof value.node_id !== "string" ||
		typeof value.name !== "string" ||
		typeof value.full_name !== "string" ||
		typeof value.default_branch !== "string" ||
		typeof value.private !== "boolean" ||
		typeof value.owner.login !== "string"
	) {
		throw new Error("GitHub returned an invalid installation repository");
	}
	return {
		defaultBranch: value.default_branch,
		fullName: value.full_name,
		id: String(value.id),
		isPrivate: value.private,
		name: value.name,
		nodeId: value.node_id,
		owner: value.owner.login,
	};
}

async function githubFetch(
	path: string,
	input: {
		readonly authorization: string;
		readonly fetch?: typeof globalThis.fetch;
		readonly method: "GET" | "POST";
	},
): Promise<Response> {
	const response = await (input.fetch ?? globalThis.fetch)(
		`${GITHUB_API}${path}`,
		{
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: input.authorization,
				"X-GitHub-Api-Version": GITHUB_API_VERSION,
				"User-Agent": "opaline-repository-evidence/1",
			},
			method: input.method,
		},
	);
	if (!response.ok) {
		throw new Error(
			`GitHub App request failed with HTTP ${response.status} (${response.headers.get("x-github-request-id") ?? "no-request-id"})`,
		);
	}
	return response;
}

function encodeJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function stateSignature(payload: string, secret: string): string {
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

function deriveGitHubPkceVerifier(state: string, secret: string): string {
	return createHmac("sha256", secret)
		.update(`github-user-authorization:${state}`)
		.digest("base64url");
}

function verifyStatePayload(input: {
	readonly now?: Date;
	readonly state: string;
	readonly stateSecret: string;
}): unknown {
	const [encoded, providedSignature, extra] = input.state.split(".");
	if (!encoded || !providedSignature || extra !== undefined) {
		throw new Error("GitHub installation state is malformed");
	}
	const expectedSignature = stateSignature(encoded, input.stateSecret);
	const expected = Buffer.from(expectedSignature);
	const provided = Buffer.from(providedSignature);
	if (
		expected.length !== provided.length ||
		!timingSafeEqual(expected, provided)
	) {
		throw new Error("GitHub installation state signature is invalid");
	}
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		throw new Error("GitHub installation state payload is invalid");
	}
	if (!isStatePayload(value)) {
		throw new Error("GitHub installation state payload is invalid");
	}
	const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
	if (value.exp < nowSeconds || value.iat > nowSeconds + 60) {
		throw new Error("GitHub installation state has expired");
	}
	return value;
}

function assertInstallationId(value: string): void {
	if (!/^[1-9][0-9]*$/u.test(value)) {
		throw new Error("GitHub installation ID is invalid");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface StatePayload {
	readonly exp: number;
	readonly iat: number;
	readonly installationId?: unknown;
	readonly nonce: string;
	readonly organizationId: string;
	readonly phase: unknown;
	readonly userId: string;
	readonly version: 2;
	readonly workspaceSlug: string;
}

function isStatePayload(value: unknown): value is StatePayload {
	if (!isRecord(value)) return false;
	return (
		value.version === INSTALL_STATE_VERSION &&
		Number.isSafeInteger(value.iat) &&
		Number.isSafeInteger(value.exp) &&
		typeof value.nonce === "string" &&
		value.nonce.length >= 16 &&
		typeof value.organizationId === "string" &&
		value.organizationId.length > 0 &&
		typeof value.userId === "string" &&
		value.userId.length > 0 &&
		typeof value.workspaceSlug === "string" &&
		value.workspaceSlug.length > 0
	);
}

function isInstallStatePayload(value: unknown): value is StatePayload & {
	readonly phase: "install";
} {
	return isStatePayload(value) && value.phase === "install";
}

function isUserAuthorizationStatePayload(
	value: unknown,
): value is StatePayload & {
	readonly installationId: string;
	readonly phase: "authorize";
} {
	return (
		isStatePayload(value) &&
		value.phase === "authorize" &&
		typeof value.installationId === "string" &&
		/^[1-9][0-9]*$/u.test(value.installationId)
	);
}
