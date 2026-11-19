import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	prepareServerArtifact,
	type ServerArtifactContext,
} from "./server-artifact.js";

export interface ServerDistribution {
	readonly kind: "checkout" | "packaged";
	readonly root: string;
	readonly entry: string;
	readonly webDir: string;
	readonly hasWebBuild: boolean;
	readonly source: string;
	readonly version?: string;
	readonly sha256?: string;
	readonly minimumBun?: string;
}

export interface PreparedServerDistribution extends ServerDistribution {
	readonly reused: boolean;
	install(): void;
	discard(): void;
}

export const SERVER_DIR_ENV = "OPALINE_SERVER_DIR";

export function resolveCheckoutDistribution(
	environment: NodeJS.ProcessEnv = process.env,
): ServerDistribution | Error | undefined {
	const configured = environment[SERVER_DIR_ENV]?.trim();
	if (!configured) return undefined;
	const root = resolve(configured);
	const entry = join(
		root,
		"apps",
		"desktop",
		"server",
		"src",
		"selfhost",
		"main.ts",
	);
	if (!existsSync(entry))
		return new Error(
			`${SERVER_DIR_ENV}=${configured} has no apps/desktop/server/src/selfhost/main.ts. Point it at an Opaline server checkout that includes self-hosting.`,
		);
	const webDir = join(root, "apps", "desktop", "ui", "dist");
	return {
		kind: "checkout",
		root,
		entry,
		webDir,
		hasWebBuild: existsSync(join(webDir, "index.html")),
		source: `checkout ${root}`,
	};
}

export async function prepareServerDistribution(
	context: ServerArtifactContext,
): Promise<PreparedServerDistribution | Error> {
	const checkout = resolveCheckoutDistribution(context.env);
	if (checkout instanceof Error) return checkout;
	if (checkout)
		return { ...checkout, reused: true, install() {}, discard() {} };
	try {
		const artifact = await prepareServerArtifact(context);
		return {
			kind: "packaged",
			root: artifact.installDir,
			entry: artifact.entry,
			webDir: artifact.webDir,
			hasWebBuild: artifact.hasWebBuild,
			source: artifact.source,
			version: artifact.version,
			sha256: artifact.sha256,
			minimumBun: artifact.minimumBun,
			reused: artifact.reused,
			install: () => artifact.install(),
			discard: () => artifact.discard(),
		};
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}
