import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ARTIFACT_PACKAGE_NAME = "@opalinehq/server";

export const ARTIFACT_MINIMUM_BUN = "1.3.8";

export const ARTIFACT_LAYOUT = {
	manifest: "opaline-server.json",
	entry: "server/main.js",
	webDir: "web/dist",
	pluginDir: "web/dist-plugin",
	postgresMigrate: "sql-schema/scripts/migrate.js",
	postgresMigrations: "sql-schema/db/migrations",
	clickHouseSchemaDir: "ch-schema",
} as const;

export interface ArtifactManifest {
	readonly name: string;
	readonly version: string;
	readonly entry: string;
	readonly webDir: string;
	readonly minimumBun: string;
	readonly builtAt: string;
	readonly commit: string;
}

export interface ServerLayout {
	readonly kind: "checkout" | "artifact";
	readonly root: string;
	readonly version: string | null;
	readonly webDir: string | null;
	readonly postgresMigrateScript: string;
	readonly clickHouseSchemaDir: string;
}

export function resolveServerLayout(entryDir: string): ServerLayout {
	const artifactRoot = resolve(entryDir, "..");
	const manifestPath = join(artifactRoot, ARTIFACT_LAYOUT.manifest);
	if (existsSync(manifestPath)) {
		const manifest = readArtifactManifest(
			readFileSync(manifestPath, "utf8"),
			manifestPath,
		);
		const webDir = join(artifactRoot, manifest.webDir);
		return {
			kind: "artifact",
			root: artifactRoot,
			version: manifest.version,
			webDir: existsSync(join(webDir, "index.html")) ? webDir : null,
			postgresMigrateScript: join(
				artifactRoot,
				ARTIFACT_LAYOUT.postgresMigrate,
			),
			clickHouseSchemaDir: join(
				artifactRoot,
				ARTIFACT_LAYOUT.clickHouseSchemaDir,
			),
		};
	}
	const checkout = resolve(entryDir, "../../../..");
	return {
		kind: "checkout",
		root: checkout,
		version: null,
		webDir: null,
		postgresMigrateScript: join(checkout, "packages/sql-schema/src/migrate.ts"),
		clickHouseSchemaDir: join(checkout, "packages/ch-schema"),
	};
}

export function readArtifactManifest(
	text: string,
	path: string,
): ArtifactManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`${path} is not valid JSON`);
	}
	const record = (parsed ?? {}) as Record<string, unknown>;
	const field = (name: keyof ArtifactManifest): string => {
		const value = record[name];
		if (typeof value !== "string" || value.trim() === "")
			throw new Error(`${path} has no ${name}`);
		return value;
	};
	const manifest: ArtifactManifest = {
		name: field("name"),
		version: field("version"),
		entry: field("entry"),
		webDir: field("webDir"),
		minimumBun: field("minimumBun"),
		builtAt: field("builtAt"),
		commit: field("commit"),
	};
	if (manifest.name !== ARTIFACT_PACKAGE_NAME)
		throw new Error(
			`${path} describes ${manifest.name}, not ${ARTIFACT_PACKAGE_NAME}`,
		);
	return manifest;
}

export function layoutEnvironment(
	env: Readonly<Record<string, string | undefined>>,
	layout: ServerLayout,
): Record<string, string> {
	const defaults: Record<string, string> = {};
	if (layout.version && !env.OPALINE_VERSION?.trim())
		defaults.OPALINE_VERSION = layout.version;
	if (layout.webDir && !env.OPALINE_WEB_DIR?.trim())
		defaults.OPALINE_WEB_DIR = layout.webDir;
	return defaults;
}
