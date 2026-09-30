import { expect, test } from "bun:test";

test.each([
	"./github-evidence-persistence.service.ts",
	"./github-webhook-delivery.service.ts",
	"../handlers/github-webhook-http.ts",
	"./pull-request-dashboard.service.ts",
])("imports %s without database configuration or module mocks", async (module) => {
	const environment = { ...process.env };
	delete environment.PG_CONNECTION_STRING;
	delete environment.CLICKHOUSE_URL;
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`await import(${JSON.stringify(new URL(module, import.meta.url).href)});`,
		],
		{ env: environment, stderr: "pipe", stdout: "pipe" },
	);
	const [exitCode, stderr] = await Promise.all([
		subprocess.exited,
		new Response(subprocess.stderr).text(),
	]);

	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
});
