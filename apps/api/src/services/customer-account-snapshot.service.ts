import type postgres from "postgres";
import { type ClickHouseExecutor, getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";

type CustomerAccountSql = postgres.Sql | postgres.TransactionSql;

interface CustomerUsageRow {
	active_members_30d: number;
	agent_runs_7d: number;
	agent_runs_30d: number;
	last_active_at: string | null;
	organization_id: string;
}

export async function refreshCustomerAccountSnapshot(
	organizationId: string,
	executor: CustomerAccountSql = sqlClient,
): Promise<void> {
	await refreshOperationalSnapshots(executor, organizationId);
}

export async function refreshAllCustomerAccountSnapshots(
	executor: CustomerAccountSql = sqlClient,
): Promise<number> {
	return refreshOperationalSnapshots(executor);
}

export async function refreshCustomerUsageSnapshots(
	limit = 100,
	clickhouse: ClickHouseExecutor = getClickhouse(),
	executor: CustomerAccountSql = sqlClient,
): Promise<number> {
	assertBatchSize(limit);
	const accounts = await executor.unsafe<Array<{ organization_id: string }>>(
		`SELECT organization_id
		FROM customer_account_snapshot
		ORDER BY usage_refreshed_at ASC NULLS FIRST, organization_id
		LIMIT $1`,
		[limit],
	);
	if (accounts.length === 0) return 0;
	const organizationIds = accounts.map((account) => account.organization_id);
	const usage = await clickhouse.query<CustomerUsageRow>({
		clickhouse_settings: {
			max_bytes_to_read: String(1024 * 1024 * 1024),
			max_execution_time: 30,
			max_rows_to_read: "5000000",
		},
		query: `
			SELECT
				organization_id,
				countIf(session_date >= now() - INTERVAL 7 DAY) AS agent_runs_7d,
				count() AS agent_runs_30d,
				uniqExact(user_id) AS active_members_30d,
				formatDateTime(max(last_interaction_date), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS last_active_at
			FROM rudel.session_analytics FINAL
			WHERE source IN ('claude_code', 'codex')
				AND organization_id IN {organizationIds:Array(String)}
				AND session_date >= now() - INTERVAL 30 DAY
			GROUP BY organization_id
		`,
		query_params: { organizationIds },
	});
	const usageByOrganization = new Map(
		usage.map((row) => [row.organization_id, row]),
	);
	for (const organizationId of organizationIds) {
		const row = usageByOrganization.get(organizationId);
		await executor.unsafe(
			`UPDATE customer_account_snapshot
			SET agent_runs_7d = $2,
				agent_runs_30d = $3,
				active_members_30d = $4,
				last_active_at = $5,
				usage_refreshed_at = NOW(),
				updated_at = NOW()
			WHERE organization_id = $1`,
			[
				organizationId,
				row?.agent_runs_7d ?? 0,
				row?.agent_runs_30d ?? 0,
				row?.active_members_30d ?? 0,
				row?.last_active_at ?? null,
			],
		);
	}
	return organizationIds.length;
}

async function refreshOperationalSnapshots(
	executor: CustomerAccountSql,
	organizationId?: string,
): Promise<number> {
	const rows = await executor.unsafe<Array<{ organization_id: string }>>(
		`INSERT INTO customer_account_snapshot (
			organization_id, organization_name, organization_slug,
			organization_created_at, billing_plan, billing_period,
			subscription_status, payment_status, seat_quantity, member_count,
			last_paid_amount, last_paid_currency, last_paid_at
		)
		SELECT
			o.id, o.name, o.slug, o.created_at,
			COALESCE(bs.plan, 'free'), COALESCE(bs.billing_period, 'none'),
			COALESCE(bs.status, 'none'),
			CASE
				WHEN bs.organization_id IS NULL THEN 'free'
				WHEN bs.status = 'trialing' THEN 'trialing'
				WHEN bs.status = 'active' AND bs.last_paid_at IS NOT NULL THEN 'paid'
				ELSE bs.status
			END,
			COALESCE(bs.seat_quantity, 0), COUNT(m.id)::int,
			bs.last_paid_amount, bs.last_paid_currency, bs.last_paid_at
		FROM organization o
		LEFT JOIN billing_subscription bs ON bs.organization_id = o.id
		LEFT JOIN member m ON m.organization_id = o.id
		WHERE ($1::text IS NULL OR o.id = $1)
		GROUP BY o.id, bs.organization_id, bs.plan, bs.billing_period, bs.status,
			bs.seat_quantity, bs.last_paid_amount, bs.last_paid_currency, bs.last_paid_at
		ON CONFLICT (organization_id) DO UPDATE SET
			organization_name = EXCLUDED.organization_name,
			organization_slug = EXCLUDED.organization_slug,
			organization_created_at = EXCLUDED.organization_created_at,
			billing_plan = EXCLUDED.billing_plan,
			billing_period = EXCLUDED.billing_period,
			subscription_status = EXCLUDED.subscription_status,
			payment_status = EXCLUDED.payment_status,
			seat_quantity = EXCLUDED.seat_quantity,
			member_count = EXCLUDED.member_count,
			last_paid_amount = EXCLUDED.last_paid_amount,
			last_paid_currency = EXCLUDED.last_paid_currency,
			last_paid_at = EXCLUDED.last_paid_at,
			updated_at = NOW()
		WHERE ROW(
			customer_account_snapshot.organization_name,
			customer_account_snapshot.organization_slug,
			customer_account_snapshot.billing_plan,
			customer_account_snapshot.billing_period,
			customer_account_snapshot.subscription_status,
			customer_account_snapshot.payment_status,
			customer_account_snapshot.seat_quantity,
			customer_account_snapshot.member_count,
			customer_account_snapshot.last_paid_amount,
			customer_account_snapshot.last_paid_currency,
			customer_account_snapshot.last_paid_at
		) IS DISTINCT FROM ROW(
			EXCLUDED.organization_name, EXCLUDED.organization_slug,
			EXCLUDED.billing_plan, EXCLUDED.billing_period,
			EXCLUDED.subscription_status, EXCLUDED.payment_status,
			EXCLUDED.seat_quantity, EXCLUDED.member_count,
			EXCLUDED.last_paid_amount, EXCLUDED.last_paid_currency,
			EXCLUDED.last_paid_at
		)
		RETURNING organization_id`,
		[organizationId ?? null],
	);
	return rows.length;
}

function assertBatchSize(limit: number): void {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new Error("Customer account batch size must be between 1 and 100");
	}
}
