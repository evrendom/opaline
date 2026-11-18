import { z } from "zod";
import { sanitizeForTerminalDisplay } from "./safe-url.js";

const SelfHostInfoSchema = z.object({
	selfHosted: z.literal(true),
	version: z.string().optional(),
	appUrl: z.string(),
	mcpUrl: z.string(),
	setupComplete: z.boolean(),
	auth: z
		.object({
			password: z.boolean().optional(),
			emailCodes: z.boolean().optional(),
			social: z.array(z.string()).optional(),
		})
		.optional(),
});

const SelfHostSetupSchema = z.object({
	user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
	organization: z.object({
		id: z.string(),
		slug: z.string(),
		name: z.string(),
	}),
	apiKey: z.string().min(1),
	apiKeyId: z.string().optional(),
	loginUrl: z.string().optional(),
});

const LoginLinkSchema = z.object({ loginUrl: z.string() });

const MemberLoginLinkSchema = z.object({
	loginUrl: z.string(),
	expiresAt: z.string(),
	user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
});

const ErrorBodySchema = z.object({
	error: z.string(),
	message: z.string().optional(),
});

export type MemberLoginLink = z.infer<typeof MemberLoginLinkSchema>;

export type SelfHostCredential =
	| { readonly kind: "setup-token"; readonly value: string }
	| { readonly kind: "api-key"; readonly value: string };

export class MemberLoginLinkError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | null,
		message: string,
	) {
		super(message);
		this.name = "MemberLoginLinkError";
	}
}

export type SelfHostInfo = z.infer<typeof SelfHostInfoSchema>;
export type SelfHostSetup = z.infer<typeof SelfHostSetupSchema>;

export interface SelfHostSetupRequest {
	readonly email: string;
	readonly name: string;
	readonly workspaceName: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchSelfHostInfo(
	apiBase: string,
	timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<SelfHostInfo | null> {
	const response = await fetch(endpoint(apiBase, "/api/selfhost/info"), {
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (response.status === 404) return null;
	return parseResponse(response, SelfHostInfoSchema, "server info");
}

export async function runSelfHostSetup(
	apiBase: string,
	setupToken: string,
	request: SelfHostSetupRequest,
): Promise<SelfHostSetup> {
	const response = await fetch(endpoint(apiBase, "/api/selfhost/setup"), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Opaline-Setup-Token": setupToken,
		},
		body: JSON.stringify(request),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 4),
	});
	return parseResponse(response, SelfHostSetupSchema, "first-run setup");
}

export async function createSelfHostLoginLink(
	apiBase: string,
	apiKey: string,
): Promise<string> {
	const response = await fetch(endpoint(apiBase, "/api/selfhost/login-link"), {
		method: "POST",
		headers: { "x-api-key": apiKey },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	return (await parseResponse(response, LoginLinkSchema, "login link"))
		.loginUrl;
}

export async function createSelfHostMemberLoginLink(
	apiBase: string,
	credential: SelfHostCredential,
	email: string,
): Promise<MemberLoginLink> {
	const wanted = email.trim().toLowerCase();
	const response = await fetch(endpoint(apiBase, "/api/selfhost/login-link"), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(credential.kind === "setup-token"
				? { "X-Opaline-Setup-Token": credential.value }
				: { "x-api-key": credential.value }),
		},
		body: JSON.stringify({ email: wanted }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const text = await response.text();
	if (!response.ok) {
		const parsed = ErrorBodySchema.safeParse(safeJson(text));
		const code = parsed.success ? parsed.data.error : null;
		throw new MemberLoginLinkError(
			response.status,
			code,
			describeMemberLinkRefusal(response.status, code, wanted, credential) ??
				`The server refused the sign-in link request (HTTP ${response.status})${describeBody(text)}`,
		);
	}
	const parsed = MemberLoginLinkSchema.safeParse(safeJson(text));
	if (!parsed.success || parsed.data.user.email.toLowerCase() !== wanted)
		throw new MemberLoginLinkError(
			response.status,
			null,
			"This server cannot create sign-in links for teammates yet; update it to a version that can.",
		);
	return parsed.data;
}

function describeMemberLinkRefusal(
	status: number,
	code: string | null,
	email: string,
	credential: SelfHostCredential,
): string | null {
	const shown = sanitizeForTerminalDisplay(email);
	if (status === 404 && code === "user_not_found")
		return `No account on this server has the email ${shown}. Invite them from Settings > Members instead.`;
	if (status === 404)
		return "This server does not create sign-in links for teammates: it is not a self-hosted Opaline server, or it is older than this CLI.";
	if (status === 403)
		return `Your account cannot sign in as ${shown}: only owners and admins of a workspace ${shown} belongs to can, and admins cannot sign in as owners.`;
	if (status === 401)
		return credential.kind === "setup-token"
			? "The server did not accept this machine's setup token; is `opaline server` running from this data directory?"
			: "The server did not accept the API key; run `opaline login` again.";
	if (status === 400 && code === "invalid_body")
		return `${shown} is not an email address the server accepts.`;
	return null;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function endpoint(apiBase: string, path: string): string {
	return `${apiBase.replace(/\/+$/u, "")}${path}`;
}

async function parseResponse<T>(
	response: Response,
	schema: z.ZodType<T>,
	what: string,
): Promise<T> {
	const text = await response.text();
	if (!response.ok)
		throw new Error(
			`The server refused the ${what} request (HTTP ${response.status})${describeBody(text)}`,
		);
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new Error(`The server answered the ${what} request with non-JSON`);
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success)
		throw new Error(`The server's ${what} response has an unexpected shape`);
	return parsed.data;
}

function describeBody(text: string): string {
	const trimmed = text.trim().replaceAll(/\s+/gu, " ").slice(0, 200);
	return trimmed ? `: ${sanitizeForTerminalDisplay(trimmed)}` : "";
}
