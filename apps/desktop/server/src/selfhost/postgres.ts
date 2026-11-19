import postgres from "postgres";

export const SELF_HOSTED_SETTING = "opaline.self_hosted";

function connect(connectionString: string): postgres.Sql {
	return postgres(connectionString, {
		max: 1,
		connect_timeout: 10,
		onnotice: () => {},
	});
}

export async function preparePostgres(
	connectionString: string,
	migrateScript: string,
	open: (connectionString: string) => postgres.Sql = connect,
): Promise<{ database: string; migrated: string }> {
	const sql = open(connectionString);
	let database: string;
	try {
		const [row] = await sql<{ database: string }[]>`
			SELECT current_database() AS database
		`.catch((error: unknown) => {
			throw new Error(
				`Cannot reach Postgres at ${redact(connectionString)}: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
		database = row?.database ?? "";
		await sql
			.unsafe(
				`ALTER DATABASE ${quoteIdentifier(database)} SET ${SELF_HOSTED_SETTING} = 'on'`,
			)
			.catch((error: unknown) => {
				throw new Error(
					`Cannot mark database ${database} as self-hosted (ALTER DATABASE … SET ${SELF_HOSTED_SETTING}); the Postgres user must own the database: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	} finally {
		await sql.end({ timeout: 5 });
	}

	const migrated = await runMigrations(connectionString, migrateScript);

	const check = open(connectionString);
	try {
		const [setting] = await check<{ value: string | null }[]>`
			SELECT current_setting(${SELF_HOSTED_SETTING}, true) AS value
		`;
		if (setting?.value !== "on")
			throw new Error(
				`Postgres did not keep ${SELF_HOSTED_SETTING}=on for database ${database}; the free-plan run limit would apply`,
			);
	} finally {
		await check.end({ timeout: 5 });
	}
	return { database, migrated };
}

async function runMigrations(
	connectionString: string,
	migrateScript: string,
): Promise<string> {
	const child = Bun.spawn([process.execPath, migrateScript], {
		env: { ...process.env, PG_CONNECTION_STRING: connectionString },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0)
		throw new Error(
			`Postgres migrations failed:\n${[stdout.trim(), stderr.trim()].filter(Boolean).join("\n")}`,
		);
	const lines = stdout.trim().split("\n").filter(Boolean);
	return lines.find((line) => line.startsWith("Migrations applied")) ?? "";
}

export function quoteIdentifier(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

export function redact(connectionString: string): string {
	try {
		const url = new URL(connectionString);
		if (url.password) url.password = "***";
		return url.toString();
	} catch {
		return "the configured PG_CONNECTION_STRING";
	}
}
