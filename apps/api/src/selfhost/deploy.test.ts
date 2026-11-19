import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readSelfHostConfig } from "./config.js";
import { ARTIFACT_MINIMUM_BUN } from "./layout.js";

const ROOT = resolve(import.meta.dir, "../../../..");
const STACK = join(ROOT, "deploy/selfhost");
const read = (path: string) => readFileSync(join(STACK, path), "utf8");

interface Service {
	readonly image?: string;
	readonly build?: { context: string; args?: Record<string, string> };
	readonly profiles?: string[];
	readonly restart?: string;
	readonly environment?: Record<string, string>;
	readonly ports?: string[];
	readonly volumes?: string[];
	readonly healthcheck?: { test: string[] };
	readonly depends_on?: Record<string, { condition: string }>;
}

const compose = Bun.YAML.parse(read("compose.yaml")) as {
	services: Record<string, Service>;
	volumes: Record<string, unknown>;
};
const example = Object.fromEntries(
	read(".env.example")
		.split("\n")
		.map((line) => /^([A-Z_][A-Z0-9_]*)=(.*)$/u.exec(line))
		.filter((match): match is RegExpExecArray => match !== null)
		.map((match) => [match[1], match[2]]),
);
const VARIABLE = /\$\{([A-Z_][A-Z0-9_]*)(?::([-?])([^}]*))?\}/gu;

function interpolate(value: string, env: Record<string, string>): string {
	return value.replace(VARIABLE, (_match, name: string, op, fallback) => {
		const current = env[name];
		if (op === "?" && !current) throw new Error(`${name} is required`);
		return current || (op === "-" ? fallback : "") || "";
	});
}

function stage(dockerfile: string, name: string): string {
	const start = dockerfile.indexOf(`AS ${name}\n`);
	const next = dockerfile.indexOf("\nFROM ", start);
	return dockerfile.slice(start, next === -1 ? undefined : next);
}

describe("the self-hosted compose stack", () => {
	test("runs Opaline and Postgres in the server profile, Caddy in https, ClickHouse always", () => {
		const profiles = Object.fromEntries(
			Object.entries(compose.services).map(([name, service]) => [
				name,
				service.profiles ?? [],
			]),
		);
		expect(profiles).toEqual({
			opaline: ["server"],
			postgres: ["server"],
			clickhouse: [],
			caddy: ["https"],
		});
	});

	test("every service restarts, pins its image by digest and waits for healthy dependencies", () => {
		for (const [name, service] of Object.entries(compose.services)) {
			expect(service.restart, name).toBe("unless-stopped");
			if (service.build) expect(service.build.context, name).toBe(".");
			else
				expect(service.image ?? "", name).toMatch(
					/:[^:@]+@sha256:[0-9a-f]{64}$/u,
				);
			for (const dependency of Object.values(service.depends_on ?? {}))
				expect(dependency.condition, name).toBe("service_healthy");
		}
		expect(compose.services.postgres?.healthcheck?.test).toBeDefined();
		expect(compose.services.clickhouse?.healthcheck?.test).toBeDefined();
		expect(read("Dockerfile")).toContain("HEALTHCHECK ");
	});

	test("named volumes are declared and mounted files exist", () => {
		for (const service of Object.values(compose.services))
			for (const volume of service.volumes ?? []) {
				const [source = ""] = volume.split(":");
				if (source.startsWith("./"))
					expect(existsSync(join(STACK, source)), source).toBe(true);
				else expect(Object.keys(compose.volumes)).toContain(source);
			}
	});

	test("every variable it reads is documented in .env.example, and install.sh writes only those", () => {
		const used = [...read("compose.yaml").matchAll(VARIABLE)].map(
			(match) => match[1] ?? "",
		);
		for (const name of new Set(used))
			expect(Object.keys(example), name).toContain(name);
		const written = [
			...read("install.sh").matchAll(/env_set "?\$?([A-Z_]+)"?/gu),
		].map((match) => match[1] ?? "");
		for (const name of new Set(written))
			if (name !== "OPALINE_OWNER_EMAIL" && name !== "KEY")
				expect(Object.keys(example), name).toContain(name);
	});

	test("the ClickHouse overlay reads only variables the clickhouse service sets", () => {
		const overlay = `${read("clickhouse/config.d/opaline.xml")}${read("clickhouse/users.d/opaline.xml")}`;
		const fromEnv = [...overlay.matchAll(/from_env="([A-Z_]+)"/gu)].map(
			(match) => match[1],
		);
		expect(fromEnv.sort()).toEqual(
			Object.keys(compose.services.clickhouse?.environment ?? {}).sort(),
		);
		expect(overlay).toContain("<s3>");
		expect(overlay).toContain("<query_log>");
	});

	test("the server's environment passes the self-hosted startup checks", () => {
		const secrets = {
			...example,
			OPALINE_VERSION: "1.0.0",
			POSTGRES_PASSWORD: "a".repeat(64),
			CLICKHOUSE_PASSWORD: "b".repeat(64),
			BETTER_AUTH_SECRET: "c".repeat(64),
			OPALINE_SETUP_TOKEN: "d".repeat(64),
		};
		const env = Object.fromEntries(
			Object.entries(compose.services.opaline?.environment ?? {}).map(
				([name, value]) => [name, interpolate(value, secrets)],
			),
		);
		const dockerfile = read("Dockerfile");
		const imageEnv = Object.fromEntries(
			[
				...stage(dockerfile, "runtime").matchAll(
					/^\s*(?:ENV )?([A-Z_]+)=(\S+?)(?: \\)?$/gmu,
				),
			].map((match) => [match[1], match[2]]),
		);
		const { config } = readSelfHostConfig({ ...imageEnv, ...env });
		expect(config).toMatchObject({
			host: "0.0.0.0",
			port: 4100,
			appUrl: "http://192.168.1.10:4100",
			dataDir: "/var/lib/opaline",
		});
		expect(env.CLICKHOUSE_URL).toBe("http://clickhouse:8123");
		expect(env.PG_CONNECTION_STRING).toBe(
			`postgres://opaline:${"a".repeat(64)}@postgres:5432/opaline`,
		);
	});
});

describe("the images", () => {
	const nas = read("Dockerfile");
	const source = readFileSync(
		join(ROOT, "deploy/selfhost/source.Dockerfile"),
		"utf8",
	);

	test("the source build and the NAS image share the Bun and runtime stages", () => {
		for (const name of ["bun", "runtime"])
			expect(stage(source, name), name).toBe(stage(nas, name));
	});

	test("run the Bun the artifact declares as its minimum, checksummed per architecture", () => {
		expect(nas).toContain(`bun-v${ARTIFACT_MINIMUM_BUN}/`);
		expect([...nas.matchAll(/sha256=[0-9a-f]{64}/gu)]).toHaveLength(2);
		expect(nas).toContain("bun-linux-x64-baseline");
		expect(nas).toContain(
			'ENTRYPOINT ["bun", "--no-install", "/opt/opaline/server/main.js"]',
		);
	});
});
