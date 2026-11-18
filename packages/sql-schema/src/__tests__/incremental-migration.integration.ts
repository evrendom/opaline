import { expect, setDefaultTimeout, test } from "bun:test";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { validateDeferredConstraints } from "../post-migrate.js";

const MIGRATION_0019_TIMESTAMP = "1785426102000";
const migrationsFolder = join(import.meta.dir, "..", "..", "db", "migrations");

setDefaultTimeout(120_000);

test("applies migrations 0020-0076 to a database already migrated through 0019, main's 0043, repository evidence 0044, GitHub evidence 0045, GitHub webhook delivery 0046, repository evidence index publication 0048, GitHub outcomes 0049, organization feature readiness 0050, CLI version 0051, coordination lease 0052, and L1 edges 0055, and creates the analysis sql result and quota tables (0058) the agent query slots (0059), lets a result be removed with the visibility sync queue (0060), creates the transcript embedding quota and run question tables (0061), lets run question jobs be precomputed (0062), and creates the live session tables with a per-budget rate-limit row (0063), creates the usage digest tables (0064), gives run questions a label (0065), creates the workspace feature switches (0066), creates the moment observation, feedback and fix tables (0067), creates the Compass settings and prompt frustration tables (0068), drops the Free member cap (0069), stages saved outputs with evidence captures (0070), stages images with evidence captures and accepts image objects (0071), creates the analysis check table (0072), lifts the free-plan run limit on self-hosted databases (0073), creates the Postgres analysis log tables (0074), creates the local ingest file table (0075), and creates the local ingest milestone table (0076)", async () => {
	const journalValue: unknown = JSON.parse(
		await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
	);
	const entries = readMigrationEntries(journalValue);
	const latestMigration = entries.at(-1);
	expect(latestMigration?.tag).toBe("0076_local_ingest_milestone");
	for (const [index, entry] of entries.entries()) {
		if (index > 0) {
			expect(entry.when).toBeGreaterThan(entries[index - 1]?.when ?? 0);
		}
	}
	const connectionString = getPostgresConnectionString();
	const databaseName = `rudel_migration_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
	const migrationsThrough0019 = await createMigrationsThrough(19);
	const migrationsThrough0043 = await createMigrationsThrough(43);
	const migrationsThrough0044 = await createMigrationsThrough(44);
	const migrationsThrough0045 = await createMigrationsThrough(45);
	const migrationsThrough0046 = await createMigrationsThrough(46);
	const migrationsThrough0048 = await createMigrationsThrough(48);
	const migrationsThrough0049 = await createMigrationsThrough(49);
	const migrationsThrough0050 = await createMigrationsThrough(50);
	const migrationsThrough0051 = await createMigrationsThrough(51);
	const migrationsThrough0052 = await createMigrationsThrough(52);
	const migrationsThrough0055 = await createMigrationsThrough(55);
	const adminSql = postgres(connectionString, { max: 1 });

	try {
		await adminSql.unsafe(`CREATE DATABASE "${databaseName}"`);
		const databaseUrl = new URL(connectionString);
		databaseUrl.pathname = `/${databaseName}`;
		const migrationSql = postgres(databaseUrl.toString(), { max: 1 });

		try {
			const database = drizzle(migrationSql);
			await migrate(database, { migrationsFolder: migrationsThrough0019 });

			const [before0020] = await migrationSql<MigrationState[]>`
				SELECT
					COUNT(*)::int AS count,
					MAX(created_at)::text AS "latestTimestamp"
				FROM drizzle.__drizzle_migrations
			`;
			const [tableBefore0020] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.clickhouse_purge_job')::text AS name
			`;
			expect(before0020).toEqual({
				count: 20,
				latestTimestamp: MIGRATION_0019_TIMESTAMP,
			});
			expect(tableBefore0020?.name).toBeNull();

			await migrate(database, { migrationsFolder: migrationsThrough0043 });
			const followupColumns = await migrationSql<Array<{ name: string }>>`
				SELECT column_name AS name
				FROM information_schema.columns
				WHERE table_schema = 'public'
					AND table_name = 'clickhouse_purge_job'
					AND column_name IN ('followup_due_at', 'followup_completed_at')
				ORDER BY column_name
			`;
			expect([...followupColumns]).toEqual([
				{ name: "followup_completed_at" },
				{ name: "followup_due_at" },
			]);
			const [captureBefore0044] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.repository_evidence_capture')::text AS name
			`;
			expect(captureBefore0044?.name).toBeNull();
			await migrate(database, { migrationsFolder: migrationsThrough0044 });
			const [captureAfter0044] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.repository_evidence_capture')::text AS name
			`;
			expect(captureAfter0044?.name).toBe("repository_evidence_capture");
			const [githubBefore0045] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.github_evidence_collection')::text AS name
			`;
			expect(githubBefore0045?.name).toBeNull();
			await migrate(database, { migrationsFolder: migrationsThrough0045 });
			const [webhookBefore0046] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.github_webhook_delivery')::text AS name
			`;
			expect(webhookBefore0046?.name).toBeNull();
			await migrate(database, { migrationsFolder: migrationsThrough0046 });
			const [oauthBefore0047] = await migrationSql<TableState[]>`
				SELECT to_regclass('public."oauthAccessToken"')::text AS name
			`;
			expect(oauthBefore0047?.name).toBeNull();
			await migrate(database, { migrationsFolder: migrationsThrough0048 });
			const [sweepBefore0049] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.github_repository_sweep')::text AS name
			`;
			expect(sweepBefore0049?.name).toBeNull();
			await migrate(database, { migrationsFolder: migrationsThrough0049 });
			const [readinessBefore0050] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.organization_feature_readiness')::text AS name
			`;
			expect(readinessBefore0050?.name).toBeNull();
			await migrate(database, { migrationsFolder: migrationsThrough0050 });
			const [cliVersionBefore0051] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.user_cli_version')::text AS name
			`;
			expect(cliVersionBefore0051?.name).toBeNull();
			await migrate(database, { migrationsFolder: migrationsThrough0051 });
			const [leaseBefore0052] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.coordination_lease')::text AS name
			`;
			expect(leaseBefore0052?.name).toBeNull();
			await migrate(database, { migrationsFolder: migrationsThrough0052 });
			// 0053 must swap the size bound online over an existing ledger.
			await seedIngestJobs(migrationSql);
			// 0056 must widen the edge scope kinds online over an existing queue.
			await migrate(database, { migrationsFolder: migrationsThrough0055 });
			await seedEdgeScopes(migrationSql);

			await migrate(database, { migrationsFolder });
			expect(await readExpectedTotalBytesCheck(migrationSql)).toEqual({
				definition:
					"CHECK (((expected_total_bytes >= 0) AND (expected_total_bytes <= 268435456))) NOT VALID",
				validated: false,
			});
			const edgeScopeCheck = await readEdgeScopeKindCheck(migrationSql);
			expect(edgeScopeCheck?.validated).toBe(false);
			expect(edgeScopeCheck?.definition).toContain("'run_index'::text");
			expect(edgeScopeCheck?.definition).toEndWith(" NOT VALID");
			expect(await validateDeferredConstraints(migrationSql)).toEqual([
				{
					constraint: "ingest_job_expected_total_bytes_check",
					status: "validated",
				},
				{ constraint: "l1_edge_scope_kind_check", status: "validated" },
				{
					constraint: "repository_evidence_object_kind_check",
					status: "validated",
				},
			]);
			expect(await validateDeferredConstraints(migrationSql)).toEqual([
				{
					constraint: "ingest_job_expected_total_bytes_check",
					status: "already_valid",
				},
				{ constraint: "l1_edge_scope_kind_check", status: "already_valid" },
				{
					constraint: "repository_evidence_object_kind_check",
					status: "already_valid",
				},
			]);
			const sqlTables = await migrationSql<{ table_name: string }[]>`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public'
					AND table_name IN ('analysis_sql_result', 'analysis_sql_quota', 'analysis_query_slot', 'analysis_visibility_sync')
				ORDER BY table_name
			`;
			expect([...sqlTables]).toEqual([
				{ table_name: "analysis_query_slot" },
				{ table_name: "analysis_sql_quota" },
				{ table_name: "analysis_sql_result" },
				{ table_name: "analysis_visibility_sync" },
			]);
			// 0060: a counted result can be removed; results say whether they carry text.
			const removable = await migrationSql<
				{ column_name: string; is_nullable: string }[]
			>`
				SELECT column_name, is_nullable FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'analysis_sql_result'
					AND column_name IN ('output', 'removed_at', 'counts', 'query_carries_text')
				ORDER BY column_name
			`;
			expect([...removable]).toEqual([
				{ column_name: "counts", is_nullable: "NO" },
				{ column_name: "output", is_nullable: "YES" },
				{ column_name: "query_carries_text", is_nullable: "NO" },
				{ column_name: "removed_at", is_nullable: "YES" },
			]);
			// 0059: one row per agent query slot.
			const [slots] = await migrationSql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM analysis_query_slot
			`;
			expect(slots?.count).toBe(4);
			// 0061: transcript search's OpenAI quota and the run question tables.
			const searchAndQuestionTables = await migrationSql<
				{ table_name: string }[]
			>`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public'
					AND (table_name = 'transcript_embedding_quota' OR table_name LIKE 'run\\_question%')
				ORDER BY table_name
			`;
			expect([...searchAndQuestionTables]).toEqual([
				{ table_name: "run_question" },
				{ table_name: "run_question_job" },
				{ table_name: "run_question_quota" },
				{ table_name: "transcript_embedding_quota" },
			]);
			// 0062: a run question job may be precomputation of new runs.
			const [purposeCheck] = await migrationSql<{ definition: string }[]>`
				SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
				WHERE conname = 'run_question_job_purpose_check'
			`;
			expect(purposeCheck?.definition).toContain("'precompute'");
			// 0063: live session tables, and a user may hold one rate-limit
			// counter per budget.
			const liveSessionTables = await migrationSql<{ table_name: string }[]>`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public'
					AND table_name LIKE 'live\\_session%'
				ORDER BY table_name
			`;
			expect([...liveSessionTables]).toEqual([
				{ table_name: "live_session" },
				{ table_name: "live_session_chunk" },
				{ table_name: "live_session_stream" },
			]);
			const rateLimitUserConstraints = await migrationSql<{ name: string }[]>`
				SELECT conname AS name FROM pg_constraint
				WHERE conrelid = 'public.ingest_rate_limit_counter'::regclass
					AND contype = 'u'
				ORDER BY conname
			`;
			expect([...rateLimitUserConstraints]).toEqual([
				{ name: "ingest_rate_limit_counter_api_key_id_unique" },
			]);
			// 0064: usage digest preferences, their send queue, who got each one,
			// and the time zone the digests go out in.
			const usageDigestTables = await migrationSql<{ table_name: string }[]>`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name LIKE 'usage\\_digest%'
				ORDER BY table_name
			`;
			expect([...usageDigestTables]).toEqual([
				{ table_name: "usage_digest" },
				{ table_name: "usage_digest_delivery" },
				{ table_name: "usage_digest_preference" },
			]);
			const [timeZoneColumn] = await migrationSql<{ is_nullable: string }[]>`
				SELECT is_nullable FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'time_zone'
			`;
			expect(timeZoneColumn?.is_nullable).toBe("YES");
			// 0065: a run question may carry the short name the dashboard shows.
			const [labelColumn] = await migrationSql<{ is_nullable: string }[]>`
				SELECT is_nullable FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'run_question' AND column_name = 'label'
			`;
			expect(labelColumn?.is_nullable).toBe("YES");
			// 0066: per-workspace feature switches, deleted with the workspace.
			const featureKeys = await migrationSql<{ column_name: string }[]>`
				SELECT a.attname AS column_name
				FROM pg_constraint c
				JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
				WHERE c.conrelid = 'public.workspace_feature'::regclass AND c.contype = 'p'
				ORDER BY a.attname
			`;
			expect([...featureKeys]).toEqual([
				{ column_name: "feature" },
				{ column_name: "organization_id" },
			]);
			// 0067: moment observations, votes on them and recorded fixes.
			const momentTables = await migrationSql<{ table_name: string }[]>`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name LIKE 'moment\\_%'
				ORDER BY table_name
			`;
			expect([...momentTables]).toEqual([
				{ table_name: "moment_feedback" },
				{ table_name: "moment_fix" },
				{ table_name: "moment_observation" },
			]);
			// 0068: Compass settings and SubQ's frustration answers.
			const compassTables = await migrationSql<{ table_name: string }[]>`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public'
					AND table_name IN ('compass_settings', 'prompt_frustration')
				ORDER BY table_name
			`;
			expect([...compassTables]).toEqual([
				{ table_name: "compass_settings" },
				{ table_name: "prompt_frustration" },
			]);
			expect([
				...(await migrationSql<
					{ column_name: string; data_type: string; is_nullable: string }[]
				>`
					SELECT column_name, data_type, is_nullable FROM information_schema.columns
					WHERE table_schema = 'public' AND table_name = 'analysis_check'
					ORDER BY ordinal_position
				`),
			]).toEqual([
				{ column_name: "id", data_type: "text", is_nullable: "NO" },
				{
					column_name: "organization_id",
					data_type: "text",
					is_nullable: "NO",
				},
				{ column_name: "author_id", data_type: "text", is_nullable: "NO" },
				{ column_name: "name", data_type: "text", is_nullable: "NO" },
				{ column_name: "definition", data_type: "jsonb", is_nullable: "NO" },
				{ column_name: "enabled", data_type: "boolean", is_nullable: "NO" },
				{
					column_name: "created_at",
					data_type: "timestamp with time zone",
					is_nullable: "NO",
				},
			]);
			expect([
				...(await migrationSql<{ name: string; definition: string }[]>`
					SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint
					WHERE conrelid = 'public.analysis_check'::regclass AND contype = 'f'
					ORDER BY conname
				`),
			]).toEqual([
				{
					name: "analysis_check_author_id_user_id_fk",
					definition:
						'FOREIGN KEY (author_id) REFERENCES "user"(id) ON DELETE CASCADE',
				},
				{
					name: "analysis_check_organization_id_organization_id_fk",
					definition:
						"FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE",
				},
			]);
			expect([
				...(await migrationSql<{ indexname: string }[]>`
					SELECT indexname FROM pg_indexes
					WHERE schemaname = 'public' AND tablename = 'analysis_check'
					ORDER BY indexname
				`),
			]).toEqual([
				{ indexname: "analysis_check_owner_idx" },
				{ indexname: "analysis_check_pkey" },
			]);
			const [runLimit] = await migrationSql<{ source: string }[]>`
				SELECT prosrc AS source FROM pg_proc
				WHERE proname = 'enforce_free_workspace_agent_run_limit'
			`;
			expect(runLimit?.source).toContain(
				"current_setting('opaline.self_hosted', true) = 'on'",
			);
			expect([
				...(await migrationSql<{ name: string }[]>`
					SELECT tablename AS name FROM pg_tables
					WHERE schemaname = 'public' AND tablename LIKE 'analysis_log_%'
					ORDER BY tablename
				`),
			]).toEqual([
				{ name: "analysis_log_analysis" },
				{ name: "analysis_log_embedding" },
				{ name: "analysis_log_query" },
				{ name: "analysis_log_query_output" },
				{ name: "analysis_log_query_session" },
				{ name: "analysis_log_session_link" },
				{ name: "analysis_log_step" },
			]);
			const [localIngestFile] = await migrationSql<{ name: string | null }[]>`
				SELECT to_regclass('public.local_ingest_file')::text AS name
			`;
			expect(localIngestFile?.name).toBe("local_ingest_file");
			const [localIngestMilestone] = await migrationSql<
				{ name: string | null }[]
			>`
				SELECT to_regclass('public.local_ingest_milestone')::text AS name
			`;
			expect(localIngestMilestone?.name).toBe("local_ingest_milestone");
			expect([
				...(await migrationSql<{ child: string; definition: string }[]>`
					SELECT conrelid::regclass::text AS child, pg_get_constraintdef(oid) AS definition
					FROM pg_constraint
					WHERE contype = 'f' AND conrelid::regclass::text LIKE 'analysis_log_%'
					ORDER BY child, conname
				`),
			]).toEqual([
				{
					child: "analysis_log_embedding",
					definition:
						"FOREIGN KEY (analysis_id) REFERENCES analysis_log_analysis(id) ON DELETE CASCADE",
				},
				{
					child: "analysis_log_query",
					definition:
						"FOREIGN KEY (analysis_id) REFERENCES analysis_log_analysis(id) ON DELETE CASCADE",
				},
				{
					child: "analysis_log_query_output",
					definition:
						"FOREIGN KEY (query_id) REFERENCES analysis_log_query(id) ON DELETE CASCADE",
				},
				{
					child: "analysis_log_query_session",
					definition:
						"FOREIGN KEY (query_id) REFERENCES analysis_log_query(id) ON DELETE CASCADE",
				},
				{
					child: "analysis_log_session_link",
					definition:
						"FOREIGN KEY (analysis_id) REFERENCES analysis_log_analysis(id) ON DELETE CASCADE",
				},
				{
					child: "analysis_log_step",
					definition:
						"FOREIGN KEY (analysis_id) REFERENCES analysis_log_analysis(id) ON DELETE CASCADE",
				},
			]);
			expect([
				...(await migrationSql<{ indexname: string; indexdef: string }[]>`
					SELECT indexname, indexdef FROM pg_indexes
					WHERE schemaname = 'public' AND tablename = 'analysis_log_query'
					ORDER BY indexname
				`),
			]).toEqual([
				{
					indexname: "analysis_log_query_analysis_idx",
					indexdef:
						"CREATE INDEX analysis_log_query_analysis_idx ON public.analysis_log_query USING btree (analysis_id)",
				},
				{
					indexname: "analysis_log_query_output_created_idx",
					indexdef:
						"CREATE INDEX analysis_log_query_output_created_idx ON public.analysis_log_query USING btree (has_output, created_at)",
				},
				{
					indexname: "analysis_log_query_owner_ids_idx",
					indexdef:
						"CREATE INDEX analysis_log_query_owner_ids_idx ON public.analysis_log_query USING gin (owner_ids)",
				},
				{
					indexname: "analysis_log_query_pkey",
					indexdef:
						"CREATE UNIQUE INDEX analysis_log_query_pkey ON public.analysis_log_query USING btree (id)",
				},
			]);
			await expectIngestJobSizeBound(migrationSql);
			await expectEdgeScopeKinds(migrationSql);
			// 0057: existing workspaces keep the own-sessions-only option off.
			expect([
				...(await migrationSql<Array<{ ownSessionsOnly: boolean }>>`
					SELECT own_sessions_only AS "ownSessionsOnly"
					FROM organization
					WHERE id = 'migration-ingest-org'
				`),
			]).toEqual([{ ownSessionsOnly: false }]);
			const mcpTables = await migrationSql<Array<{ name: string }>>`
				SELECT tablename AS name
				FROM pg_tables
				WHERE schemaname = 'public'
					AND tablename IN (
						'mcp_user_setting',
						'oauthAccessToken',
						'oauthApplication',
						'oauthConsent'
					)
				ORDER BY tablename
			`;
			expect([...mcpTables]).toEqual([
				{ name: "mcp_user_setting" },
				{ name: "oauthAccessToken" },
				{ name: "oauthApplication" },
				{ name: "oauthConsent" },
			]);

			const [after0052] = await migrationSql<MigrationState[]>`
				SELECT
					COUNT(*)::int AS count,
					MAX(created_at)::text AS "latestTimestamp"
				FROM drizzle.__drizzle_migrations
			`;
			const [tableAfter0020] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.clickhouse_purge_job')::text AS name
			`;
			expect(after0052).toEqual({
				count: 77,
				latestTimestamp: String(latestMigration?.when),
			});
			const [trendsSourceTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.trends_source')::text AS name
			`;
			expect(trendsSourceTable?.name).toBe("trends_source");
			const [edgeScopeTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.l1_edge_scope')::text AS name
			`;
			expect(edgeScopeTable?.name).toBe("l1_edge_scope");
			const [cliVersionTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.user_cli_version')::text AS name
			`;
			expect(cliVersionTable?.name).toBe("user_cli_version");
			const leaseColumns = await migrationSql<
				Array<{ name: string; nullable: string }>
			>`
				SELECT column_name AS name, is_nullable AS nullable
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'coordination_lease'
				ORDER BY column_name
			`;
			expect([...leaseColumns]).toEqual([
				{ name: "acquired_at", nullable: "NO" },
				{ name: "expires_at", nullable: "NO" },
				{ name: "holder", nullable: "NO" },
				{ name: "name", nullable: "NO" },
			]);
			const publicationColumns = await migrationSql<Array<{ name: string }>>`
				SELECT column_name AS name
				FROM information_schema.columns
				WHERE table_schema = 'public'
					AND table_name = 'repository_evidence_capture'
					AND column_name IN ('index_row', 'index_published_at', 'index_next_attempt_at', 'saved_outputs', 'images')
				ORDER BY column_name
			`;
			// 0070: saved output rows staged with the capture, published with its index row.
			// 0071: image rows likewise.
			expect(publicationColumns.map((column) => column.name)).toEqual([
				"images",
				"index_next_attempt_at",
				"index_published_at",
				"index_row",
				"saved_outputs",
			]);
			const outcomesTables = await migrationSql<Array<{ name: string }>>`
				SELECT tablename AS name FROM pg_tables
				WHERE schemaname = 'public' AND tablename IN (
					'github_pull_request', 'github_pull_request_commit', 'github_ci_run',
					'github_ci_job', 'github_repository_sweep'
				)
			`;
			expect([...outcomesTables]).toEqual([
				{ name: "github_repository_sweep" },
			]);
			const [readinessAfter0050] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.organization_feature_readiness')::text AS name
			`;
			expect(readinessAfter0050?.name).toBe("organization_feature_readiness");
			const [customerAccountTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.customer_account_snapshot')::text AS name
			`;
			expect(customerAccountTable?.name).toBe("customer_account_snapshot");
			const billingTables = await migrationSql<Array<{ name: string }>>`
				SELECT tablename AS name
				FROM pg_tables
				WHERE schemaname = 'public'
					AND tablename IN (
						'billing_analytics_outbox',
						'billing_checkout_attempt',
						'billing_customer',
						'billing_subscription',
						'organization_monthly_usage',
						'stripe_webhook_event'
					)
				ORDER BY tablename
			`;
			expect([...billingTables]).toEqual([
				{ name: "billing_analytics_outbox" },
				{ name: "billing_checkout_attempt" },
				{ name: "billing_customer" },
				{ name: "billing_subscription" },
				{ name: "organization_monthly_usage" },
				{ name: "stripe_webhook_event" },
			]);
			const pendingSeatColumns = await migrationSql<Array<{ name: string }>>`
				SELECT column_name AS name
				FROM information_schema.columns
				WHERE table_schema = 'public'
					AND table_name = 'billing_subscription'
					AND column_name IN (
						'pending_seat_expires_at',
						'pending_seat_quantity'
					)
				ORDER BY column_name
			`;
			expect([...pendingSeatColumns]).toEqual([
				{ name: "pending_seat_expires_at" },
				{ name: "pending_seat_quantity" },
			]);
			const [memberLimitTrigger] = await migrationSql<TableState[]>`
				SELECT trigger_name AS name
				FROM information_schema.triggers
				WHERE event_object_schema = 'public'
					AND event_object_table = 'member'
					AND trigger_name = 'member_free_workspace_limit'
			`;
			// 0069 drops the Free member cap: every plan has unlimited members.
			expect(memberLimitTrigger).toBeUndefined();
			const [agentRunLimitTrigger] = await migrationSql<TableState[]>`
				SELECT trigger_name AS name
				FROM information_schema.triggers
				WHERE event_object_schema = 'public'
					AND event_object_table = 'session_ownership'
					AND trigger_name = 'session_ownership_free_workspace_agent_run_limit'
			`;
			expect(agentRunLimitTrigger?.name).toBe(
				"session_ownership_free_workspace_agent_run_limit",
			);
			expect(tableAfter0020?.name).toBe("clickhouse_purge_job");
			const [arrivalsIndex] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.session_ownership_arrivals_idx')::text AS name
			`;
			expect(arrivalsIndex?.name).toBe("session_ownership_arrivals_idx");
			const [nativeParentIndex] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.session_ownership_native_parent_idx')::text AS name
			`;
			expect(nativeParentIndex?.name).toBe(
				"session_ownership_native_parent_idx",
			);
			const [agentMetadataScanIndex] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.session_ownership_agent_metadata_scan_idx')::text AS name
			`;
			expect(agentMetadataScanIndex?.name).toBe(
				"session_ownership_agent_metadata_scan_idx",
			);
			const nativeLineageColumns = await migrationSql<Array<{ name: string }>>`
				SELECT column_name AS name
				FROM information_schema.columns
				WHERE table_schema = 'public'
					AND table_name = 'session_ownership'
					AND column_name IN (
						'agent_source',
						'agent_metadata_scanned_at',
						'agent_metadata_scan_outcome',
						'native_parent_session_id',
						'native_lineage_projected_at',
						'native_lineage_projected_signature',
						'native_subagent_model',
						'native_subagent_path',
						'arrival_notified_at'
					)
				ORDER BY column_name
			`;
			expect([...nativeLineageColumns]).toEqual([
				{ name: "agent_metadata_scan_outcome" },
				{ name: "agent_metadata_scanned_at" },
				{ name: "agent_source" },
				{ name: "arrival_notified_at" },
				{ name: "native_lineage_projected_at" },
				{ name: "native_lineage_projected_signature" },
				{ name: "native_parent_session_id" },
				{ name: "native_subagent_model" },
				{ name: "native_subagent_path" },
			]);
			const [repositoryUploadTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.repository_upload_report')::text AS name
			`;
			expect(repositoryUploadTable?.name).toBe("repository_upload_report");
			const captureTables = await migrationSql<
				Array<{ name: string; relation: string | null }>
			>`
				SELECT expected.name, to_regclass('public.' || expected.name)::text AS relation
				FROM (VALUES
					('clickhouse_purge_object'),
					('github_app_installation'),
					('github_ci_log_receipt'),
					('github_evidence_collection'),
					('github_evidence_object_intent'),
					('github_pull_request_snapshot'),
					('github_repository_binding'),
					('github_webhook_delivery'),
					('repository_evidence_capture'),
					('repository_evidence_object'),
					('repository_evidence_upload'),
					('repository_evidence_upload_intent'),
					('repository_evidence_upload_object')
				) AS expected(name)
				ORDER BY expected.name
			`;
			expect([...captureTables]).toEqual(
				captureTables.map(({ name }) => ({ name, relation: name })),
			);
			const deletionActions = await migrationSql<
				Array<{ name: string; onDelete: string; onUpdate: string }>
			>`
				SELECT
					conname AS name,
					CASE confdeltype
						WHEN 'c' THEN 'cascade'
						WHEN 'n' THEN 'set null'
						ELSE confdeltype::text
					END AS "onDelete",
					CASE confupdtype
						WHEN 'c' THEN 'cascade'
						WHEN 'n' THEN 'set null'
						WHEN 'a' THEN 'no action'
						ELSE confupdtype::text
					END AS "onUpdate"
				FROM pg_constraint
				WHERE conname IN (
					'clickhouse_purge_object_purge_job_id_clickhouse_purge_job_id_fk',
					'github_app_installation_installed_by_user_id_user_id_fk',
					'github_webhook_delivery_organization_id_organization_id_fk',
					'repository_evidence_upload_object_object_fk'
				)
				ORDER BY conname
			`;
			expect([...deletionActions]).toEqual([
				{
					name: "clickhouse_purge_object_purge_job_id_clickhouse_purge_job_id_fk",
					onDelete: "cascade",
					onUpdate: "cascade",
				},
				{
					name: "github_app_installation_installed_by_user_id_user_id_fk",
					onDelete: "set null",
					onUpdate: "no action",
				},
				{
					name: "github_webhook_delivery_organization_id_organization_id_fk",
					onDelete: "cascade",
					onUpdate: "no action",
				},
				{
					name: "repository_evidence_upload_object_object_fk",
					onDelete: "cascade",
					onUpdate: "no action",
				},
			]);
			const probeId = crypto.randomUUID();
			await migrationSql`INSERT INTO dependency_health_probe (id) VALUES (${probeId})`;
			const probe = await migrationSql<
				{ id: string }[]
			>`SELECT id FROM dependency_health_probe WHERE id = ${probeId}`;
			expect(probe[0]?.id).toBe(probeId);
			const [cliConnectionTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.cli_connection')::text AS name
			`;
			expect(cliConnectionTable?.name).toBe("cli_connection");
			const profileColumns = await migrationSql<
				Array<{ name: string }>
			>`SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='user' AND column_name='job_title'`;
			expect([...profileColumns]).toEqual([{ name: "job_title" }]);
			const cliConnectionIndexes = await migrationSql<Array<{ name: string }>>`
				SELECT indexname AS name FROM pg_indexes
				WHERE schemaname = 'public' AND tablename = 'cli_connection'
				ORDER BY indexname
			`;
			expect([...cliConnectionIndexes]).toEqual([
				{ name: "cli_connection_browser_expires_idx" },
				{ name: "cli_connection_device_user_code_unique" },
				{ name: "cli_connection_expires_idx" },
				{ name: "cli_connection_pairing_hash_unique" },
				{ name: "cli_connection_pkey" },
				{ name: "cli_connection_source_created_idx" },
			]);
			const [ingestJobTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.ingest_job')::text AS name
			`;
			expect(ingestJobTable?.name).toBe("ingest_job");
			const [processingLedgerTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.ingest_processing_ledger')::text AS name
			`;
			expect(processingLedgerTable?.name).toBe("ingest_processing_ledger");
			const [sessionRevisionTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.session_ingest_revision')::text AS name
			`;
			expect(sessionRevisionTable?.name).toBe("session_ingest_revision");
			const sessionRevisionIndexes = await migrationSql<
				Array<{ name: string }>
			>`
				SELECT indexname AS name
				FROM pg_indexes
				WHERE schemaname = 'public'
					AND tablename = 'session_ingest_revision'
				ORDER BY indexname
			`;
			expect([...sessionRevisionIndexes]).toEqual([
				{ name: "session_ingest_revision_created_at_idx" },
				{ name: "session_ingest_revision_pkey" },
				{ name: "session_ingest_revision_value_idx" },
			]);
			const [targetReceiptTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.ingest_processing_target_receipt')::text AS name
			`;
			expect(targetReceiptTable?.name).toBe("ingest_processing_target_receipt");
			const [ingestRateLimitTable] = await migrationSql<TableState[]>`
				SELECT to_regclass('public.ingest_rate_limit_counter')::text AS name
			`;
			expect(ingestRateLimitTable?.name).toBe("ingest_rate_limit_counter");
			const ingestRateLimitChecks = await migrationSql<Array<{ name: string }>>`
				SELECT conname AS name
				FROM pg_constraint
				WHERE conrelid = 'public.ingest_rate_limit_counter'::regclass
					AND contype = 'c'
				ORDER BY conname
			`;
			expect([...ingestRateLimitChecks]).toEqual([
				{ name: "ingest_rate_limit_counter_decision_check" },
				{ name: "ingest_rate_limit_counter_subject_check" },
				{ name: "ingest_rate_limit_counter_value_check" },
			]);
			const targetReceiptChecks = await migrationSql<Array<{ name: string }>>`
				SELECT conname AS name
				FROM pg_constraint
				WHERE conrelid = 'public.ingest_processing_target_receipt'::regclass
					AND contype = 'c'
				ORDER BY conname
			`;
			expect([...targetReceiptChecks]).toEqual([
				{ name: "ingest_processing_target_receipt_row_count_check" },
				{ name: "ingest_processing_target_receipt_target_check" },
			]);
			const processingLedgerIndexes = await migrationSql<
				Array<{ name: string }>
			>`
				SELECT indexname AS name
				FROM pg_indexes
				WHERE schemaname = 'public'
					AND tablename = 'ingest_processing_ledger'
				ORDER BY indexname
			`;
			expect([...processingLedgerIndexes]).toEqual([
				{ name: "ingest_processing_ledger_identity_idx" },
				{ name: "ingest_processing_ledger_pkey" },
			]);
			const ingestJobIndexes = await migrationSql<Array<{ name: string }>>`
				SELECT indexname AS name
				FROM pg_indexes
				WHERE schemaname = 'public'
					AND tablename = 'ingest_job'
				ORDER BY indexname
			`;
			expect([...ingestJobIndexes]).toEqual([
				{ name: "ingest_job_cleanup_idx" },
				{ name: "ingest_job_expiry_idx" },
				{ name: "ingest_job_pending_available_idx" },
				{ name: "ingest_job_pkey" },
				{ name: "ingest_job_running_lease_expiry_idx" },
				{ name: "ingest_job_session_idx" },
			]);
			const [expiresAtColumn] = await migrationSql<
				Array<{ defaultValue: string | null; nullable: string }>
			>`
				SELECT
					column_default AS "defaultValue",
					is_nullable AS nullable
				FROM information_schema.columns
				WHERE table_schema = 'public'
					AND table_name = 'ingest_job'
					AND column_name = 'expires_at'
			`;
			expect(expiresAtColumn).toEqual({
				defaultValue: "(now() + '24:00:00'::interval)",
				nullable: "NO",
			});
			const ingestJobChecks = await migrationSql<Array<{ name: string }>>`
				SELECT conname AS name
				FROM pg_constraint
				WHERE conrelid = 'public.ingest_job'::regclass
					AND contype = 'c'
				ORDER BY conname
			`;
			const [expectedTotalBytesCheck] = await migrationSql<
				Array<{ definition: string }>
			>`
				SELECT pg_get_constraintdef(oid) AS definition
				FROM pg_constraint
				WHERE conrelid = 'public.ingest_job'::regclass
					AND conname = 'ingest_job_expected_total_bytes_check'
			`;
			expect(expectedTotalBytesCheck?.definition).toBe(
				"CHECK (((expected_total_bytes >= 0) AND (expected_total_bytes <= 268435456)))",
			);
			expect([...ingestJobChecks]).toEqual([
				{ name: "ingest_job_attempts_check" },
				{ name: "ingest_job_content_sha256_check" },
				{ name: "ingest_job_error_check" },
				{ name: "ingest_job_expected_total_bytes_check" },
				{ name: "ingest_job_json_shape_check" },
				{ name: "ingest_job_lease_check" },
				{ name: "ingest_job_max_attempts_check" },
				{ name: "ingest_job_source_check" },
				{ name: "ingest_job_status_check" },
				{ name: "ingest_job_terminal_state_check" },
			]);
			const shapeColumns = await migrationSql<Array<{ name: string }>>`
				SELECT column_name AS name
				FROM information_schema.columns
				WHERE table_schema = 'public'
					AND table_name = 'session_ownership'
					AND column_name IN (
						'last_content_bytes',
						'last_assistant_line_count',
						'last_content_shape_json',
						'last_filter_version',
						'last_session_date',
						'usage_extraction_generation',
						'last_usage_content_sha256',
						'last_usage_extraction_version',
						'last_usage_event_identity_version',
						'last_usage_model_rate_card_version',
						'last_usage_event_count',
						'last_usage_checksum',
						'last_usage_diagnostics_json',
						'last_usage_completed_generation',
						'last_usage_completed_at'
					)
				ORDER BY column_name
			`;
			expect([...shapeColumns]).toEqual([
				{ name: "last_assistant_line_count" },
				{ name: "last_content_bytes" },
				{ name: "last_content_shape_json" },
				{ name: "last_filter_version" },
				{ name: "last_session_date" },
				{ name: "last_usage_checksum" },
				{ name: "last_usage_completed_at" },
				{ name: "last_usage_completed_generation" },
				{ name: "last_usage_content_sha256" },
				{ name: "last_usage_diagnostics_json" },
				{ name: "last_usage_event_count" },
				{ name: "last_usage_event_identity_version" },
				{ name: "last_usage_extraction_version" },
				{ name: "last_usage_model_rate_card_version" },
				{ name: "usage_extraction_generation" },
			]);
		} finally {
			await migrationSql.end();
		}
	} finally {
		await adminSql.unsafe(
			`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
		);
		await adminSql.end();
		await rm(migrationsThrough0019, { force: true, recursive: true });
		await rm(migrationsThrough0043, { force: true, recursive: true });
		await rm(migrationsThrough0044, { force: true, recursive: true });
		await rm(migrationsThrough0045, { force: true, recursive: true });
		await rm(migrationsThrough0046, { force: true, recursive: true });
		await rm(migrationsThrough0048, { force: true, recursive: true });
		await rm(migrationsThrough0049, { force: true, recursive: true });
		await rm(migrationsThrough0050, { force: true, recursive: true });
		await rm(migrationsThrough0051, { force: true, recursive: true });
		await rm(migrationsThrough0052, { force: true, recursive: true });
		await rm(migrationsThrough0055, { force: true, recursive: true });
	}
});

test("a fresh database gets the 256 MiB ingest_job bound NOT VALID, then validated outside the migration", async () => {
	const connectionString = getPostgresConnectionString();
	const databaseName = `rudel_migration_fresh_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
	const adminSql = postgres(connectionString, { max: 1 });
	try {
		await adminSql.unsafe(`CREATE DATABASE "${databaseName}"`);
		const databaseUrl = new URL(connectionString);
		databaseUrl.pathname = `/${databaseName}`;
		const migrationSql = postgres(databaseUrl.toString(), { max: 1 });
		try {
			await migrate(drizzle(migrationSql), { migrationsFolder });
			expect((await readExpectedTotalBytesCheck(migrationSql))?.validated).toBe(
				false,
			);
			expect(await validateDeferredConstraints(migrationSql)).toEqual([
				{
					constraint: "ingest_job_expected_total_bytes_check",
					status: "validated",
				},
				{ constraint: "l1_edge_scope_kind_check", status: "validated" },
				{
					constraint: "repository_evidence_object_kind_check",
					status: "validated",
				},
			]);
			await expectIngestJobSizeBound(migrationSql);
			await expectEdgeScopeKinds(migrationSql);
		} finally {
			await migrationSql.end();
		}
	} finally {
		await adminSql.unsafe(
			`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
		);
		await adminSql.end();
	}
});

async function seedIngestJobs(sql: postgres.Sql): Promise<void> {
	await sql`
		INSERT INTO "user" (id, name, email)
		VALUES ('migration-ingest-user', 'Migration', 'migration-ingest@example.com')
	`;
	await sql`
		INSERT INTO organization (id, name, slug)
		VALUES ('migration-ingest-org', 'Migration', 'migration-ingest-org')
	`;
	await sql`
		INSERT INTO ingest_job (
			id, organization_id, user_id, session_id, source, object_manifest,
			expected_sizes, expected_total_bytes, client_hashes, ingest_metadata
		)
		SELECT 'migration-job-' || n, 'migration-ingest-org', 'migration-ingest-user',
			'migration-session-' || n, 'claude_code', '[]', '{}', 134217728, '{}', '{}'
		FROM generate_series(1, 50) AS n
	`;
}

async function readExpectedTotalBytesCheck(
	sql: postgres.Sql,
): Promise<{ definition: string; validated: boolean } | undefined> {
	const [row] = await sql<Array<{ definition: string; validated: boolean }>>`
		SELECT pg_get_constraintdef(oid) AS definition, convalidated AS validated
		FROM pg_constraint
		WHERE conrelid = 'public.ingest_job'::regclass
			AND conname = 'ingest_job_expected_total_bytes_check'
	`;
	return row;
}

/** 256 MiB jobs are accepted and larger ones refused. */
async function expectIngestJobSizeBound(sql: postgres.Sql): Promise<void> {
	await sql`
		INSERT INTO "user" (id, name, email)
		VALUES ('migration-bound-user', 'Bound', 'migration-bound@example.com')
		ON CONFLICT DO NOTHING
	`;
	await sql`
		INSERT INTO organization (id, name, slug)
		VALUES ('migration-bound-org', 'Bound', 'migration-bound-org')
		ON CONFLICT DO NOTHING
	`;
	// `.execute()` starts the lazy postgres.js query so `rejects` can observe it.
	const insert = (id: string, bytes: number) =>
		sql`
			INSERT INTO ingest_job (
				id, organization_id, user_id, session_id, source, object_manifest,
				expected_sizes, expected_total_bytes, client_hashes, ingest_metadata
			)
			VALUES (${id}, 'migration-bound-org', 'migration-bound-user', ${id},
				'claude_code', '[]', '{}', ${bytes}, '{}', '{}')
		`.execute();
	await insert("migration-bound-max", 268_435_456);
	await expect(insert("migration-bound-over", 268_435_457)).rejects.toThrow(
		"ingest_job_expected_total_bytes_check",
	);
}

/** A session and a repository scope queued before 0056. */
async function seedEdgeScopes(sql: postgres.Sql): Promise<void> {
	await sql`
		INSERT INTO l1_edge_scope (organization_id, scope_kind, scope_id, user_id, source, session_id, repository_id)
		VALUES ('migration-ingest-org', 'session', 'migration-ingest-user/claude_code/s', 'migration-ingest-user', 'claude_code', 's', NULL),
			('migration-ingest-org', 'repository', '101', NULL, NULL, NULL, '101')
	`;
}

async function readEdgeScopeKindCheck(
	sql: postgres.Sql,
): Promise<{ definition: string; validated: boolean } | undefined> {
	const [row] = await sql<Array<{ definition: string; validated: boolean }>>`
		SELECT pg_get_constraintdef(oid) AS definition, convalidated AS validated
		FROM pg_constraint
		WHERE conrelid = 'public.l1_edge_scope'::regclass
			AND conname = 'l1_edge_scope_kind_check'
	`;
	return row;
}

/** A run index scope is a session's; one without its session is refused. */
async function expectEdgeScopeKinds(sql: postgres.Sql): Promise<void> {
	await sql`
		INSERT INTO "user" (id, name, email)
		VALUES ('migration-scope-user', 'Scope', 'migration-scope@example.com')
		ON CONFLICT DO NOTHING
	`;
	await sql`
		INSERT INTO organization (id, name, slug)
		VALUES ('migration-scope-org', 'Scope', 'migration-scope-org')
		ON CONFLICT DO NOTHING
	`;
	// `.execute()` starts the lazy postgres.js query so `rejects` can observe it.
	const insert = (kind: string, userId: string | null) =>
		sql`
			INSERT INTO l1_edge_scope (organization_id, scope_kind, scope_id, user_id, source, session_id)
			VALUES ('migration-scope-org', ${kind}, ${`${kind}-${userId}`}, ${userId}, 'codex', 's')
		`.execute();
	await insert("run_index", "migration-scope-user");
	await expect(insert("run_index", null)).rejects.toThrow(
		"l1_edge_scope_kind_check",
	);
	await expect(insert("runs", "migration-scope-user")).rejects.toThrow(
		"l1_edge_scope_kind_check",
	);
}

interface MigrationJournalEntry {
	breakpoints: boolean;
	idx: number;
	tag: string;
	version: string;
	when: number;
}

interface MigrationState {
	count: number;
	latestTimestamp: string;
}

interface TableState {
	name: string | null;
}

async function createMigrationsThrough(lastIndex: number): Promise<string> {
	const journalValue: unknown = JSON.parse(
		await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
	);
	const entries = readMigrationEntries(journalValue).filter(
		(entry) => entry.idx <= lastIndex,
	);
	if (entries.length !== lastIndex + 1 || entries.at(-1)?.idx !== lastIndex) {
		throw new Error(`Expected migrations 0000 through ${lastIndex}`);
	}

	const temporaryFolder = await mkdtemp(
		join(tmpdir(), `rudel-migrations-through-${lastIndex}-`),
	);
	await mkdir(join(temporaryFolder, "meta"));
	for (const entry of entries) {
		await copyFile(
			join(migrationsFolder, `${entry.tag}.sql`),
			join(temporaryFolder, `${entry.tag}.sql`),
		);
	}
	await writeFile(
		join(temporaryFolder, "meta", "_journal.json"),
		`${JSON.stringify({ dialect: "postgresql", entries, version: "7" }, null, "\t")}\n`,
	);
	return temporaryFolder;
}

function readMigrationEntries(value: unknown): MigrationJournalEntry[] {
	if (
		typeof value !== "object" ||
		value === null ||
		!("entries" in value) ||
		!Array.isArray(value.entries) ||
		!value.entries.every(isMigrationJournalEntry)
	) {
		throw new Error("Invalid Drizzle migration journal");
	}
	return value.entries;
}

function isMigrationJournalEntry(
	value: unknown,
): value is MigrationJournalEntry {
	return (
		typeof value === "object" &&
		value !== null &&
		"breakpoints" in value &&
		typeof value.breakpoints === "boolean" &&
		"idx" in value &&
		typeof value.idx === "number" &&
		"tag" in value &&
		typeof value.tag === "string" &&
		"version" in value &&
		typeof value.version === "string" &&
		"when" in value &&
		typeof value.when === "number"
	);
}

function getPostgresConnectionString(): string {
	const connectionString = process.env.PG_CONNECTION_STRING;
	if (!connectionString) {
		throw new Error("PG_CONNECTION_STRING is required for integration tests");
	}
	return connectionString;
}
