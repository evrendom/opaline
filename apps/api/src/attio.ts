import { getLogger } from "@logtape/logtape";

const ATTIO_API_BASE_URL = "https://api.attio.com/v2";
const ATTIO_SYNC_TIMEOUT_MS = 5_000;
const logger = getLogger(["rudel", "api", "attio"]);
const RESERVED_TEST_EMAIL_DOMAIN =
	/@(?:test\.com|example\.(?:com|org|net)|[^@]+\.(?:test|invalid|localhost))$/iu;
const SYNTHETIC_EMAIL_MARKER =
	/smoke|(?:^|[+._-])(canary|payload|playwright|e2e|integration[-_]?test|fixture|synthetic|ci[-_]?test|test|demo|preview|fake|debug|probe|repro)(?:[+._-]|\d|$)/iu;
const GENERIC_SYNTHETIC_NAME =
	/^(?:test(?:[ #+_-].*)?|demo(?:[ #+_-].*)?|.*(?:[+._ -])test)$/iu;
const PERSONAL_EMAIL_DOMAINS = new Set([
	"126.com",
	"163.com",
	"aol.com",
	"duck.com",
	"fastmail.com",
	"foxmail.com",
	"gmail.com",
	"gmx.com",
	"gmx.de",
	"googlemail.com",
	"hey.com",
	"hotmail.com",
	"icloud.com",
	"live.com",
	"mac.com",
	"mail.com",
	"mail.ru",
	"me.com",
	"msn.com",
	"naver.com",
	"outlook.com",
	"proton.me",
	"protonmail.com",
	"pm.me",
	"qq.com",
	"web.de",
	"yahoo.com",
	"yandex.com",
	"yandex.ru",
	"zoho.com",
]);
const PERSONAL_EMAIL_DOMAIN_SUFFIXES = [".33mail.com"] as const;
const INTERNAL_EMAIL_DOMAINS = new Set([
	"opaline.local",
	"opaline.so",
	"rudel.ai",
]);

export interface AttioConfig {
	accessToken: string | undefined;
}

export interface AttioSignupUser {
	createdAt: Date | string;
	email: string;
	id: string;
	name: string;
}

export interface AttioUserActivity {
	agentRuns30d: number | undefined;
	email: string;
	lastActiveAt: Date | string;
	userId: string;
}

export interface AttioPersonCustomer360 extends AttioSignupUser {
	agentRuns30d: number;
	lastActiveAt: Date | string | null;
}

export interface AttioCompanyCustomer360 {
	activeDevelopers30d: number;
	agentRuns7d: number;
	agentRuns30d: number;
	billingPlan: string;
	developerCount: number;
	domain: string;
	lastActiveAt: Date | string | null;
	paidWorkspaceCount: number;
	paymentStatus: string;
	workspaceCount: number;
}

export function getAttioCompanyDomain(email: string): string | undefined {
	const domain = email.split("@").at(1)?.trim().toLowerCase();
	if (
		!domain ||
		!domain.includes(".") ||
		PERSONAL_EMAIL_DOMAINS.has(domain) ||
		PERSONAL_EMAIL_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix)) ||
		INTERNAL_EMAIL_DOMAINS.has(domain)
	) {
		return undefined;
	}
	return domain;
}

export function isAttioSyntheticIdentity(user: AttioSignupUser): boolean {
	const email = user.email.trim();
	const emailLocalPart = email.split("@", 1)[0] ?? "";
	return (
		RESERVED_TEST_EMAIL_DOMAIN.test(email) ||
		SYNTHETIC_EMAIL_MARKER.test(emailLocalPart) ||
		GENERIC_SYNTHETIC_NAME.test(user.name.trim())
	);
}

interface AttioAttributeDefinition {
	apiSlug: string;
	title: string;
	type: "number" | "text" | "timestamp";
}

const peopleAttributes: readonly AttioAttributeDefinition[] = [
	{ apiSlug: "opaline_user_id", title: "Opaline user ID", type: "text" },
];

const userAttributes: readonly AttioAttributeDefinition[] = [
	{
		apiSlug: "opaline_joined_at",
		title: "Opaline joined at",
		type: "timestamp",
	},
	{
		apiSlug: "opaline_last_active_at",
		title: "Opaline last active at",
		type: "timestamp",
	},
	{
		apiSlug: "opaline_agent_runs_30d",
		title: "Opaline agent runs (30d)",
		type: "number",
	},
];

const companyAttributes: readonly AttioAttributeDefinition[] = [
	{
		apiSlug: "opaline_developers",
		title: "Opaline developers",
		type: "number",
	},
	{
		apiSlug: "opaline_active_developers_30d",
		title: "Active developers (30d)",
		type: "number",
	},
	{
		apiSlug: "opaline_agent_runs_7d",
		title: "Agent runs (7d)",
		type: "number",
	},
	{
		apiSlug: "opaline_agent_runs_30d",
		title: "Agent runs (30d)",
		type: "number",
	},
	{
		apiSlug: "opaline_last_active_at",
		title: "Last active at",
		type: "timestamp",
	},
	{ apiSlug: "opaline_billing_plan", title: "Billing plan", type: "text" },
	{
		apiSlug: "opaline_payment_status",
		title: "Payment status",
		type: "text",
	},
	{
		apiSlug: "opaline_paid_workspaces",
		title: "Paid accounts",
		type: "number",
	},
	{
		apiSlug: "opaline_workspace_count",
		title: "Product accounts",
		type: "number",
	},
];

export async function syncSignupToAttio(
	config: AttioConfig | undefined,
	user: AttioSignupUser,
): Promise<void> {
	if (!config?.accessToken?.trim() || isAttioSyntheticIdentity(user)) return;

	const requests = buildAttioSignupRequests(config, user);
	try {
		await ensureAttioPeopleAttributes(config);
		await ensureAttioUserAttributes(config);
		if (getAttioCompanyDomain(user.email)) {
			await ensureAttioCompanyAttributes(config);
		}
		const signal = AbortSignal.timeout(ATTIO_SYNC_TIMEOUT_MS);
		for (const request of requests) {
			const response = await fetch(request, { signal });
			if (!response.ok) {
				throw new Error(
					`Attio request failed with HTTP ${response.status} ${response.statusText}`,
				);
			}
		}
	} catch (error) {
		logger.error("Failed to sync new user {userId} to Attio: {error}", {
			error,
			userId: user.id,
		});
	}
}

export function buildAttioSignupRequests(
	config: AttioConfig | undefined,
	user: AttioSignupUser,
): readonly Request[] {
	const accessToken = config?.accessToken?.trim();
	if (!accessToken) {
		return [];
	}
	if (isAttioSyntheticIdentity(user)) return [];

	const companyDomain = getAttioCompanyDomain(user.email);
	const personRequest = buildAttioPersonRequest(config, {
		...user,
		agentRuns30d: 0,
		lastActiveAt: null,
	});
	const userRequest = buildAttioUserRequest(config, {
		...user,
		agentRuns30d: 0,
		lastActiveAt: null,
	});
	return [
		...(companyDomain
			? [
					buildUpsertRequest(
						"companies",
						"domains",
						{ domains: companyDomain },
						accessToken,
					),
				]
			: []),
		...(personRequest ? [personRequest] : []),
		...(userRequest ? [userRequest] : []),
	];
}

export function buildAttioPersonRequest(
	config: AttioConfig | undefined,
	person: AttioPersonCustomer360,
): Request | undefined {
	const accessToken = config?.accessToken?.trim();
	if (!accessToken || isAttioSyntheticIdentity(person)) return undefined;
	const companyDomain = getAttioCompanyDomain(person.email);
	return buildUpsertRequest(
		"people",
		"email_addresses",
		{
			...(companyDomain ? { company: companyDomain } : {}),
			email_addresses: person.email,
			name: buildAttioPersonName(person.name, person.email),
			opaline_user_id: person.id,
		},
		accessToken,
	);
}

export function buildAttioUserRequest(
	config: AttioConfig | undefined,
	user: AttioPersonCustomer360,
): Request | undefined {
	const accessToken = config?.accessToken?.trim();
	if (!accessToken || isAttioSyntheticIdentity(user)) return undefined;
	return buildUpsertRequest(
		"users",
		"user_id",
		{
			opaline_agent_runs_30d: user.agentRuns30d,
			opaline_joined_at: formatAttioTimestamp(user.createdAt),
			opaline_last_active_at: user.lastActiveAt
				? formatAttioTimestamp(user.lastActiveAt)
				: null,
			person: user.email,
			primary_email_address: user.email,
			user_id: user.id,
		},
		accessToken,
	);
}

export function buildAttioCompanyCustomer360Request(
	config: AttioConfig | undefined,
	company: AttioCompanyCustomer360,
): Request | undefined {
	const accessToken = config?.accessToken?.trim();
	if (!accessToken) return undefined;
	return buildUpsertRequest(
		"companies",
		"domains",
		{
			domains: company.domain,
			opaline_active_developers_30d: company.activeDevelopers30d,
			opaline_agent_runs_7d: company.agentRuns7d,
			opaline_agent_runs_30d: company.agentRuns30d,
			opaline_billing_plan: company.billingPlan,
			opaline_developers: company.developerCount,
			...(company.lastActiveAt
				? {
						opaline_last_active_at: formatAttioTimestamp(company.lastActiveAt),
					}
				: {}),
			opaline_paid_workspaces: company.paidWorkspaceCount,
			opaline_payment_status: company.paymentStatus,
			opaline_workspace_count: company.workspaceCount,
		},
		accessToken,
	);
}

export async function ensureAttioCompanyAttributes(
	config: AttioConfig | undefined,
): Promise<void> {
	await ensureAttioAttributes(config, "companies", companyAttributes);
}

export async function ensureAttioPeopleAttributes(
	config: AttioConfig | undefined,
): Promise<void> {
	await ensureAttioAttributes(config, "people", peopleAttributes);
}

export async function ensureAttioUserAttributes(
	config: AttioConfig | undefined,
): Promise<void> {
	await ensureAttioAttributes(config, "users", userAttributes);
}

export function buildAttioUserActivityRequest(
	config: AttioConfig | undefined,
	activity: AttioUserActivity,
): Request | undefined {
	const accessToken = config?.accessToken?.trim();
	if (!accessToken) return undefined;
	return buildUpsertRequest(
		"users",
		"user_id",
		{
			...(activity.agentRuns30d === undefined
				? {}
				: { opaline_agent_runs_30d: activity.agentRuns30d }),
			opaline_last_active_at: formatAttioTimestamp(activity.lastActiveAt),
			primary_email_address: activity.email,
			user_id: activity.userId,
		},
		accessToken,
	);
}

export async function syncUserActivityToAttio(
	config: AttioConfig | undefined,
	activity: AttioUserActivity,
): Promise<void> {
	const request = buildAttioUserActivityRequest(config, activity);
	if (!request) return;
	await ensureAttioUserAttributes(config);
	const response = await fetch(request, {
		signal: AbortSignal.timeout(ATTIO_SYNC_TIMEOUT_MS),
	});
	if (!response.ok) {
		const detail = await readAttioErrorDetail(response);
		throw new Error(
			`Attio user activity sync failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
		);
	}
}

async function ensureAttioAttributes(
	config: AttioConfig | undefined,
	object: string,
	attributes: readonly AttioAttributeDefinition[],
): Promise<void> {
	const accessToken = config?.accessToken?.trim();
	if (!accessToken) return;

	const response = await fetch(
		`${ATTIO_API_BASE_URL}/objects/${object}/attributes`,
		{
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(ATTIO_SYNC_TIMEOUT_MS),
		},
	);
	if (!response.ok) {
		throw new Error(
			`Attio ${object} attribute list failed with HTTP ${response.status}`,
		);
	}
	const payload: unknown = await response.json();
	const existingSlugs = readAttioAttributeSlugs(payload);
	for (const attribute of attributes) {
		if (existingSlugs.has(attribute.apiSlug)) continue;
		const createResponse = await fetch(
			`${ATTIO_API_BASE_URL}/objects/${object}/attributes`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					data: {
						api_slug: attribute.apiSlug,
						config: {},
						description: "Synced from Opaline customer activity.",
						is_multiselect: false,
						is_required: false,
						is_unique: false,
						title: attribute.title,
						type: attribute.type,
					},
				}),
				signal: AbortSignal.timeout(ATTIO_SYNC_TIMEOUT_MS),
			},
		);
		if (!createResponse.ok && createResponse.status !== 409) {
			throw new Error(
				`Attio ${object} attribute create failed for ${attribute.apiSlug} with HTTP ${createResponse.status}`,
			);
		}
	}
}

export async function readAttioErrorDetail(
	response: Response,
): Promise<string | undefined> {
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return undefined;
	}
	if (typeof payload !== "object" || payload === null) return undefined;

	const code = Reflect.get(payload, "code");
	const message = Reflect.get(payload, "message");
	const safeCode = typeof code === "string" ? code.slice(0, 100) : undefined;
	const safeMessage =
		typeof message === "string" ? message.slice(0, 500) : undefined;
	if (safeCode && safeMessage) return `${safeCode}: ${safeMessage}`;
	return safeMessage ?? safeCode;
}

function formatAttioTimestamp(value: Date | string): string {
	const date = typeof value === "string" ? new Date(value) : value;
	if (Number.isNaN(date.getTime())) {
		throw new Error("Attio timestamp is invalid");
	}
	return date.toISOString();
}

function buildUpsertRequest(
	object: string,
	matchingAttribute: string,
	values: Record<string, unknown>,
	accessToken: string,
): Request {
	const url = new URL(`${ATTIO_API_BASE_URL}/objects/${object}/records`);
	url.searchParams.set("matching_attribute", matchingAttribute);

	return new Request(url.toString(), {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ data: { values: normalizeAttioValues(values) } }),
	});
}

function normalizeAttioValues(
	values: Record<string, unknown>,
): Record<string, readonly unknown[]> {
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [
			key,
			Array.isArray(value) ? value : value == null ? [] : [value],
		]),
	);
}

function buildAttioPersonName(name: string, email: string) {
	const fullName = name.trim() || email;
	const [firstName, ...lastNameParts] = fullName.split(/\s+/u);
	return {
		first_name: firstName ?? fullName,
		full_name: fullName,
		last_name: lastNameParts.join(" "),
	};
}

function readAttioAttributeSlugs(payload: unknown): Set<string> {
	const data =
		typeof payload === "object" && payload !== null
			? Reflect.get(payload, "data")
			: undefined;
	if (!Array.isArray(data)) {
		throw new Error("Attio attribute list returned an invalid response");
	}
	return new Set(
		data.flatMap((item) => {
			if (typeof item !== "object" || item === null) return [];
			const slug = Reflect.get(item, "api_slug");
			return typeof slug === "string" ? [slug] : [];
		}),
	);
}
