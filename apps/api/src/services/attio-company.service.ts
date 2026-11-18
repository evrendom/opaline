import type postgres from "postgres";
import {
	type AttioCompanyCustomer360,
	type AttioConfig,
	type AttioPersonCustomer360,
	buildAttioCompanyCustomer360Request,
	buildAttioPersonRequest,
	buildAttioUserRequest,
	ensureAttioCompanyAttributes,
	ensureAttioPeopleAttributes,
	ensureAttioUserAttributes,
	getAttioCompanyDomain,
	isAttioSyntheticIdentity,
	readAttioErrorDetail,
} from "../attio.js";
import type { ClickHouseExecutor } from "../clickhouse.js";

type AttioCustomerSql = postgres.Sql | postgres.TransactionSql;

export interface AttioCustomerUser {
	created_at: Date | string;
	email: string;
	id: string;
	name: string;
}

export interface AttioCustomerMembership {
	billing_plan: string;
	organization_id: string;
	payment_status: string;
	user_id: string;
}

export interface AttioCustomerUsage {
	agent_runs_7d: number;
	agent_runs_30d: number;
	last_active_at: string;
	user_id: string;
}

export interface AttioCustomer360 {
	companies: readonly AttioCompanyCustomer360[];
	people: readonly AttioPersonCustomer360[];
}

export interface AttioCustomerSyncResult {
	companies: number;
	developers: number;
	people: number;
	users: number;
}

interface CompanyAccumulator {
	activeDeveloperIds: Set<string>;
	agentRuns7d: number;
	agentRuns30d: number;
	developerIds: Set<string>;
	domain: string;
	lastActiveAt: string | null;
	organizations: Map<string, AttioCustomerMembership>;
}

const ATTIO_SYNC_CONCURRENCY = 5;
const PLAN_PRIORITY = new Map([
	["free", 0],
	["basic", 1],
	["business", 2],
]);
const PAYMENT_PRIORITY = new Map([
	["free", 0],
	["none", 0],
	["trialing", 1],
	["paid", 2],
	["active", 2],
	["unpaid", 3],
	["past_due", 4],
]);

export async function syncAttioCustomer360(
	config: AttioConfig | undefined,
	executor: AttioCustomerSql,
	clickhouse: ClickHouseExecutor,
	options: { includeInactivePeople?: boolean } = {},
): Promise<AttioCustomerSyncResult> {
	if (!config?.accessToken?.trim()) {
		return { companies: 0, developers: 0, people: 0, users: 0 };
	}
	const [users, memberships, usage] = await Promise.all([
		executor.unsafe<AttioCustomerUser[]>(
			`SELECT id, email, name, created_at FROM "user" ORDER BY created_at, id`,
		),
		executor.unsafe<AttioCustomerMembership[]>(
			`SELECT m.user_id, s.organization_id, s.billing_plan, s.payment_status
			FROM member m
			INNER JOIN customer_account_snapshot s
				ON s.organization_id = m.organization_id
			ORDER BY m.user_id, s.organization_id`,
		),
		clickhouse.query<AttioCustomerUsage>({
			clickhouse_settings: {
				max_bytes_to_read: String(1024 * 1024 * 1024),
				max_execution_time: 30,
				max_rows_to_read: "5000000",
			},
			query: `
				SELECT
					user_id,
					countIf(session_date >= now() - INTERVAL 7 DAY) AS agent_runs_7d,
					count() AS agent_runs_30d,
					formatDateTime(max(last_interaction_date), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS last_active_at
				FROM rudel.session_analytics FINAL
				WHERE source IN ('claude_code', 'codex')
					AND session_date >= now() - INTERVAL 30 DAY
				GROUP BY user_id
			`,
		}),
	]);
	const customer360 = buildAttioCustomer360(users, memberships, usage);
	const people = options.includeInactivePeople
		? customer360.people
		: customer360.people.filter((person) => person.lastActiveAt !== null);
	await Promise.all([
		ensureAttioCompanyAttributes(config),
		ensureAttioPeopleAttributes(config),
		ensureAttioUserAttributes(config),
	]);
	await syncRequests(
		customer360.companies.map((company) => ({
			label: company.domain,
			request: buildAttioCompanyCustomer360Request(config, company),
		})),
	);
	await syncRequests(
		people.map((person) => ({
			label: person.email,
			request: buildAttioPersonRequest(config, person),
		})),
	);
	await syncRequests(
		people.map((person) => ({
			label: person.email,
			request: buildAttioUserRequest(config, person),
		})),
	);
	return {
		companies: customer360.companies.length,
		developers: customer360.companies.reduce(
			(total, company) => total + company.developerCount,
			0,
		),
		people: people.length,
		users: people.length,
	};
}

export function buildAttioCustomer360(
	users: readonly AttioCustomerUser[],
	memberships: readonly AttioCustomerMembership[],
	usage: readonly AttioCustomerUsage[],
): AttioCustomer360 {
	const usageByUser = new Map(usage.map((row) => [row.user_id, row]));
	const membershipsByUser = new Map<string, AttioCustomerMembership[]>();
	for (const membership of memberships) {
		const rows = membershipsByUser.get(membership.user_id) ?? [];
		rows.push(membership);
		membershipsByUser.set(membership.user_id, rows);
	}
	const companies = new Map<string, CompanyAccumulator>();
	const people: AttioPersonCustomer360[] = [];
	for (const user of users) {
		if (isAttioSyntheticIdentity(toSignupUser(user))) continue;
		const userUsage = usageByUser.get(user.id);
		people.push({
			agentRuns30d: userUsage?.agent_runs_30d ?? 0,
			createdAt: user.created_at,
			email: user.email,
			id: user.id,
			lastActiveAt: userUsage?.last_active_at ?? null,
			name: user.name,
		});
		const domain = getAttioCompanyDomain(user.email);
		if (!domain) continue;
		const company = companies.get(domain) ?? createCompanyAccumulator(domain);
		company.developerIds.add(user.id);
		if (userUsage) {
			company.activeDeveloperIds.add(user.id);
			company.agentRuns7d += userUsage.agent_runs_7d;
			company.agentRuns30d += userUsage.agent_runs_30d;
			company.lastActiveAt = newestTimestamp(
				company.lastActiveAt,
				userUsage.last_active_at,
			);
		}
		for (const membership of membershipsByUser.get(user.id) ?? []) {
			company.organizations.set(membership.organization_id, membership);
		}
		companies.set(domain, company);
	}
	return {
		companies: [...companies.values()]
			.sort((left, right) => left.domain.localeCompare(right.domain))
			.map(toCompanyCustomer360),
		people: people.sort((left, right) => left.email.localeCompare(right.email)),
	};
}

function toSignupUser(user: AttioCustomerUser) {
	return {
		createdAt: user.created_at,
		email: user.email,
		id: user.id,
		name: user.name,
	};
}

function createCompanyAccumulator(domain: string): CompanyAccumulator {
	return {
		activeDeveloperIds: new Set(),
		agentRuns7d: 0,
		agentRuns30d: 0,
		developerIds: new Set(),
		domain,
		lastActiveAt: null,
		organizations: new Map(),
	};
}

function toCompanyCustomer360(
	company: CompanyAccumulator,
): AttioCompanyCustomer360 {
	const organizations = [...company.organizations.values()];
	return {
		activeDevelopers30d: company.activeDeveloperIds.size,
		agentRuns7d: company.agentRuns7d,
		agentRuns30d: company.agentRuns30d,
		billingPlan: highestValue(
			organizations.map((organization) => organization.billing_plan),
			PLAN_PRIORITY,
			"free",
		),
		developerCount: company.developerIds.size,
		domain: company.domain,
		lastActiveAt: company.lastActiveAt,
		paidWorkspaceCount: organizations.filter(
			(organization) => organization.billing_plan !== "free",
		).length,
		paymentStatus: highestValue(
			organizations.map((organization) => organization.payment_status),
			PAYMENT_PRIORITY,
			"free",
		),
		workspaceCount: organizations.length,
	};
}

function highestValue(
	values: readonly string[],
	priorities: ReadonlyMap<string, number>,
	fallback: string,
): string {
	return values.reduce(
		(current, value) =>
			(priorities.get(value) ?? 0) > (priorities.get(current) ?? 0)
				? value
				: current,
		fallback,
	);
}

function newestTimestamp(current: string | null, candidate: string): string {
	if (!current) return candidate;
	return new Date(candidate).getTime() > new Date(current).getTime()
		? candidate
		: current;
}

async function syncRequests(
	items: readonly { label: string; request: Request | undefined }[],
): Promise<void> {
	for (let index = 0; index < items.length; index += ATTIO_SYNC_CONCURRENCY) {
		await Promise.all(
			items
				.slice(index, index + ATTIO_SYNC_CONCURRENCY)
				.map(async ({ label, request }) => {
					if (!request) return;
					const response = await fetch(request, {
						signal: AbortSignal.timeout(10_000),
					});
					if (response.ok) return;
					const detail = await readAttioErrorDetail(response);
					throw new Error(
						`Attio customer sync failed for ${label} with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
					);
				}),
		);
	}
}
