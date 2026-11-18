import { randomBytes, randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

export const DEFAULT_SERVER_PORT = 4100;
export const DEFAULT_SERVER_HOST = "127.0.0.1";
const SERVER_STATE_FILE = "server.json";

const RuntimeRecordSchema = z.object({
	source: z.enum(["explicit", "data-dir", "system", "download"]),
	version: z.string(),
	path: z.string(),
});

const LocalClickHouseSchema = z.object({
	mode: z.literal("local"),
	httpPort: z.number().int().positive(),
	tcpPort: z.number().int().positive(),
	user: z.string(),
	password: z.string(),
	memoryGiB: z.number().positive().optional(),
	runtime: RuntimeRecordSchema.optional(),
});

const ExternalClickHouseSchema = z.object({
	mode: z.literal("external"),
	url: z.string(),
	user: z.string(),
	password: z.string(),
	version: z.string().optional(),
});

const ServerStateSchema = z.object({
	version: z.literal(1),
	createdAt: z.string(),
	updatedAt: z.string(),
	port: z.number().int().positive(),
	host: z.string(),
	publicUrl: z.string(),
	secrets: z.object({
		betterAuthSecret: z.string().min(32),
		cronSecret: z.string().min(32),
		setupToken: z.string().min(32),
	}),
	clickhouse: z.discriminatedUnion("mode", [
		LocalClickHouseSchema,
		ExternalClickHouseSchema,
	]),
	postgres: z.object({
		port: z.number().int().positive(),
		user: z.string(),
		password: z.string(),
		database: z.string(),
		runtime: RuntimeRecordSchema.optional(),
	}),
	bun: RuntimeRecordSchema.optional(),
	server: z
		.object({
			kind: z.enum(["checkout", "packaged"]),
			root: z.string(),
			version: z.string().optional(),
			sha256: z.string().optional(),
			source: z.string().optional(),
			previousVersion: z.string().optional(),
		})
		.optional(),
	setup: z
		.object({
			email: z.string(),
			name: z.string(),
			userId: z.string(),
			organizationId: z.string(),
			organizationSlug: z.string(),
			organizationName: z.string(),
			apiKey: z.string(),
			apiKeyId: z.string().optional(),
			completedAt: z.string(),
		})
		.optional(),
	agentsConfiguredAt: z.string().optional(),
});

export type ServerState = z.infer<typeof ServerStateSchema>;
export type ClickHouseState = ServerState["clickhouse"];
export type RuntimeRecord = z.infer<typeof RuntimeRecordSchema>;

export function resolveServerDataDir(
	flag: string | undefined,
	environment: NodeJS.ProcessEnv = process.env,
	home: string = homedir(),
): string {
	const explicit = flag?.trim() || environment.OPALINE_SERVER_DATA_DIR?.trim();
	if (explicit) return resolve(explicit.replace(/^~(?=$|\/)/u, home));
	return join(home, ".opaline", "server");
}

export function getServerStatePath(dataDir: string): string {
	return join(dataDir, SERVER_STATE_FILE);
}

export function loadServerState(dataDir: string): ServerState | undefined {
	const path = getServerStatePath(dataDir);
	if (!existsSync(path)) return undefined;
	if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, 0o600);
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error(
			`${path} is not valid JSON. Fix or remove it; it holds this server's ports and secrets.`,
		);
	}
	const parsed = ServerStateSchema.safeParse(value);
	if (!parsed.success)
		throw new Error(
			`${path} does not look like an opaline server state file (${parsed.error.issues[0]?.path.join(".") ?? "unknown field"}: ${parsed.error.issues[0]?.message ?? "invalid"}).`,
		);
	return parsed.data;
}

export function saveServerState(dataDir: string, state: ServerState): void {
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	const path = getServerStatePath(dataDir);
	const temporary = `${path}.${randomUUID()}.tmp`;
	const next = { ...state, updatedAt: new Date().toISOString() };
	try {
		writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(temporary, path);
		chmodSync(path, 0o600);
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function generateSecret(bytes = 32): string {
	return randomBytes(bytes).toString("base64url");
}

export function createSecrets(): ServerState["secrets"] {
	return {
		betterAuthSecret: generateSecret(),
		cronSecret: generateSecret(),
		setupToken: generateSecret(),
	};
}
