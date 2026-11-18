import { expect, test } from "bun:test";
import { readCliConnectionListenUrl } from "../lib/cli-connection-database.js";

test("Neon LISTEN uses the matching direct endpoint without changing credentials or TLS", () => {
	const input =
		"postgres://fixture:p%40ss@ep-fixture-pooler.eu-central-1.aws.neon.tech/app?sslmode=require";
	expect(readCliConnectionListenUrl({ PG_CONNECTION_STRING: input })).toBe(
		input.replace("-pooler.", "."),
	);
});

test("an explicit direct URL wins and unknown poolers require configuration", () => {
	expect(
		readCliConnectionListenUrl({
			PG_CONNECTION_STRING: "postgres://db-pooler.example/app",
			PG_DIRECT_CONNECTION_STRING: "postgres://db.example/app",
		}),
	).toBe("postgres://db.example/app");
	expect(() =>
		readCliConnectionListenUrl({
			PG_CONNECTION_STRING: "postgres://db-pooler.example/app",
		}),
	).toThrow("direct PostgreSQL");
	expect(() => readCliConnectionListenUrl({})).toThrow("direct PostgreSQL");
});
