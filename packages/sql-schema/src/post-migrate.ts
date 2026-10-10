import type postgres from "postgres";

/**
 * Constraints a migration added `NOT VALID` so it never scans a live table
 * while holding ACCESS EXCLUSIVE. Drizzle applies all pending migrations in
 * one transaction, so they are validated here afterwards, each in its own
 * transaction under SHARE UPDATE EXCLUSIVE, which does not block reads or
 * writes.
 */
export const DEFERRED_CONSTRAINT_VALIDATIONS = [
	{ constraint: "ingest_job_expected_total_bytes_check", table: "ingest_job" },
	{ constraint: "l1_edge_scope_kind_check", table: "l1_edge_scope" },
] as const;

export type DeferredConstraintValidation =
	| { readonly constraint: string; readonly status: "validated" }
	| { readonly constraint: string; readonly status: "already_valid" }
	| { readonly constraint: string; readonly status: "absent" }
	| {
			readonly constraint: string;
			readonly error: string;
			readonly status: "deferred";
	  };

/**
 * Validates every deferred constraint that is still `NOT VALID`. A failure
 * (for example a lock wait over five seconds) is reported, not thrown: the
 * constraint already checks new rows, and the next run validates it.
 */
export async function validateDeferredConstraints(
	sql: postgres.Sql,
): Promise<DeferredConstraintValidation[]> {
	const results: DeferredConstraintValidation[] = [];
	for (const { constraint, table } of DEFERRED_CONSTRAINT_VALIDATIONS) {
		const [state] = await sql<{ validated: boolean }[]>`
			SELECT convalidated AS validated
			FROM pg_constraint
			WHERE conrelid = to_regclass(${`public.${table}`})
				AND conname = ${constraint}
		`;
		if (!state) {
			results.push({ constraint, status: "absent" });
			continue;
		}
		if (state.validated) {
			results.push({ constraint, status: "already_valid" });
			continue;
		}
		try {
			await sql.begin(async (transaction) => {
				await transaction.unsafe("SET LOCAL lock_timeout = '5s'");
				await transaction.unsafe(
					`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}"`,
				);
			});
			results.push({ constraint, status: "validated" });
		} catch (error) {
			results.push({
				constraint,
				error: error instanceof Error ? error.message : String(error),
				status: "deferred",
			});
		}
	}
	return results;
}
