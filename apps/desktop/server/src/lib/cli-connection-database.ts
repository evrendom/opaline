import { ORPCError } from "@orpc/server";

export function readCliConnectionListenUrl(
	environment: NodeJS.ProcessEnv = process.env,
): string {
	const value =
		environment.PG_DIRECT_CONNECTION_STRING ?? environment.PG_CONNECTION_STRING;
	if (!value) throw unavailable();
	const url = new URL(value);
	// Neon documents the direct endpoint as the same hostname without -pooler.
	// Preserve the database, credentials and TLS parameters of the application's connection.
	if (
		!environment.PG_DIRECT_CONNECTION_STRING &&
		url.hostname.endsWith(".neon.tech")
	) {
		url.hostname = url.hostname.replace("-pooler.", ".");
	}
	if (url.hostname.includes("-pooler")) throw unavailable();
	return url.toString();
}

function unavailable() {
	return new ORPCError("SERVICE_UNAVAILABLE", {
		message:
			"CLI connections require a direct PostgreSQL connection for live updates.",
	});
}
