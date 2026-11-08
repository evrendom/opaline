import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BunPlugin } from "bun";
import { FORWARD_SCRIPTS } from "../packages/ch-schema/scripts/bootstrap";
import {
	ARTIFACT_LAYOUT,
	ARTIFACT_PACKAGE_NAME,
	type ArtifactManifest,
} from "../apps/api/src/selfhost/layout";
import {
	checkReferences,
	digests,
	inlineScripts,
	listFiles,
	packDirectory,
	relativeUrlReferences,
} from "./selfhost-artifact";

const MINIMUM_BUN = "1.3.8";
const LEFT_OUT_NATIVE_MODULES = ["@resvg/resvg-js"];
const WEB_BUILD_ENV_DROPPED = /^(VITE_|SENTRY_|POSTHOG_|PUBLIC_POSTHOG_)/u;

const root = resolve(import.meta.dir, "..");
const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		version: { type: "string" },
		out: { type: "string" },
		"reuse-web": { type: "boolean", default: false },
	},
});
const version = (values.version ?? process.env.OPALINE_VERSION ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
	console.error(
		"Usage: bun run build:selfhost --version <x.y.z> (or OPALINE_VERSION=<x.y.z>) [--out dist-selfhost] [--reuse-web]",
	);
	process.exit(2);
}
const outDir = resolve(root, values.out ?? "dist-selfhost");
const stage = join(outDir, `.stage-${version}`);
const pkg = join(stage, "package");
const serverDir = join(pkg, "server");

const leaveOutNativeModules: BunPlugin = {
	name: "leave-out-native-modules",
	setup(build) {
		const filter = new RegExp(
			`^(${LEFT_OUT_NATIVE_MODULES.map((name) => name.replace(/[/.]/gu, "\\$&")).join("|")})$`,
			"u",
		);
		build.onResolve({ filter }, (args) => ({
			path: args.path,
			namespace: "left-out",
		}));
		build.onLoad({ filter: /.*/u, namespace: "left-out" }, (args) => ({
			contents: `throw new Error(${JSON.stringify(`${args.path} is a native module and is not part of the packaged Opaline server`)});`,
			loader: "js",
		}));
	},
};

const inlinePackageVersions: BunPlugin = {
	name: "inline-package-versions",
	setup(build) {
		build.onLoad(
			{ filter: /[\\/]chkit[\\/]dist[\\/]bin[\\/]version\.js$/u },
			async (args) => {
				const { version: cliVersion } = JSON.parse(
					await readFile(resolve(args.path, "../../../package.json"), "utf8"),
				) as { version: string };
				return {
					contents: `export const CLI_VERSION = ${JSON.stringify(cliVersion)};\n`,
					loader: "js",
				};
			},
		);
	},
};

async function bundle(
	label: string,
	entrypoints: string[],
	outdir: string,
): Promise<string[]> {
	const result = await Bun.build({
		entrypoints,
		outdir,
		target: "bun",
		format: "esm",
		naming: "[name].[ext]",
		plugins: [leaveOutNativeModules, inlinePackageVersions],
	});
	for (const log of result.logs)
		if (log.level === "error" || log.level === "warning")
			console.error(`${label}: ${log.message}`);
	if (!result.success) throw new Error(`${label}: bundling failed`);
	const outputs = result.outputs.map((output) => output.path);
	const unexpected = outputs.filter((path) => !path.endsWith(".js"));
	if (unexpected.length > 0)
		throw new Error(
			`${label}: the bundle emitted files the artifact cannot load on every platform: ${unexpected.map((path) => basename(path)).join(", ")}`,
		);
	for (const output of outputs)
		if ((await readFile(output, "utf8")).includes("createRequire(import.meta.url)"))
			throw new Error(
				`${label}: ${basename(output)} requires files at run time relative to itself, which the bundle does not ship`,
			);
	return outputs;
}

async function run(command: string[], cwd: string, env: NodeJS.ProcessEnv) {
	const child = Bun.spawn(command, {
		cwd,
		env,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0)
		throw new Error(`${command.join(" ")} failed in ${cwd}`);
}

async function text(command: string[]): Promise<string> {
	const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [output] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	return output.trim();
}

async function buildWeb(): Promise<void> {
	const web = join(root, "apps/web");
	const reusable =
		values["reuse-web"] &&
		existsSync(join(web, "dist/index.html")) &&
		existsSync(join(web, "dist-plugin/entry.js"));
	if (!reusable) {
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([name]) => !WEB_BUILD_ENV_DROPPED.test(name),
			),
		);
		await run(["bun", "run", "build"], web, env);
		await run(["bun", "run", "build:widget"], web, env);
	}
	await cp(join(web, "dist"), join(pkg, ARTIFACT_LAYOUT.webDir), {
		recursive: true,
	});
	await cp(join(web, "dist-plugin"), join(pkg, ARTIFACT_LAYOUT.pluginDir), {
		recursive: true,
	});
	for (const file of await listFiles(join(pkg, ARTIFACT_LAYOUT.webDir))) {
		if (!file.endsWith(".html")) continue;
		const inline = inlineScripts(
			await readFile(join(pkg, ARTIFACT_LAYOUT.webDir, file), "utf8"),
		);
		if (inline.length > 0)
			throw new Error(
				`web/${file} has inline scripts, which the server's CSP blocks: ${inline.join(" | ")}`,
			);
	}
	for (const file of await listFiles(join(pkg, "web"))) {
		if (!/\.(js|html|json)$/u.test(file)) continue;
		if (/phc_[A-Za-z0-9]{20,}/u.test(await readFile(join(pkg, "web", file), "utf8")))
			throw new Error(`web/${file} contains a PostHog project key`);
	}
}

async function buildServer(): Promise<void> {
	await bundle(
		"server",
		[join(root, "apps/api/src/selfhost/main.ts")],
		serverDir,
	);
	const services = join(root, "apps/api/src/services");
	const workers = (await readdir(services))
		.filter((name) => name.endsWith(".worker.ts"))
		.map((name) => join(services, name));
	await bundle("workers", workers, serverDir);
	await cp(
		join(services, "demo-repository-files.json.gz"),
		join(serverDir, "demo-repository-files.json.gz"),
	);
	await cp(
		join(root, "apps/api/src/assets/team-invite"),
		join(pkg, "assets/team-invite"),
		{ recursive: true },
	);

	const references = new Set<string>();
	for (const file of await readdir(serverDir))
		if (file.endsWith(".js"))
			for (const reference of relativeUrlReferences(
				await readFile(join(serverDir, file), "utf8"),
			))
				references.add(reference);
	const { missing, shims } = checkReferences(serverDir, [...references]);
	if (missing.length > 0)
		throw new Error(
			`the server bundle loads files the artifact does not ship: ${missing.join(", ")}`,
		);
	for (const shim of shims)
		await writeFile(shim.path, `import ${JSON.stringify(shim.target)};\n`);
}

async function buildSchemas(): Promise<void> {
	const chSchema = join(root, "packages/ch-schema");
	const chTarget = join(pkg, ARTIFACT_LAYOUT.clickHouseSchemaDir);
	await cp(join(chSchema, "chx/migrations"), join(chTarget, "chx/migrations"), {
		recursive: true,
	});
	await bundle(
		"clickhouse forward migrations",
		[...new Set(FORWARD_SCRIPTS.values())].map((script) =>
			join(chSchema, "scripts", script),
		),
		join(chTarget, "scripts"),
	);

	const sqlSchema = join(root, "packages/sql-schema");
	const migrations = join(pkg, ARTIFACT_LAYOUT.postgresMigrations);
	await mkdir(join(migrations, "meta"), { recursive: true });
	for (const file of await readdir(join(sqlSchema, "db/migrations")))
		if (file.endsWith(".sql"))
			await cp(join(sqlSchema, "db/migrations", file), join(migrations, file));
	await cp(
		join(sqlSchema, "db/migrations/meta/_journal.json"),
		join(migrations, "meta/_journal.json"),
	);
	const [migrate] = await bundle(
		"postgres migrations",
		[join(sqlSchema, "src/migrate.ts")],
		join(pkg, "sql-schema/scripts"),
	);
	if (migrate !== join(pkg, ARTIFACT_LAYOUT.postgresMigrate))
		throw new Error(`postgres migrate script landed at ${migrate}`);
}

await rm(stage, { recursive: true, force: true });
await mkdir(pkg, { recursive: true });
await buildServer();
await buildSchemas();
await buildWeb();

const commit = await text(["git", "rev-parse", "HEAD"]);
const dirty = (await text(["git", "status", "--porcelain"])) !== "";
const manifest: ArtifactManifest = {
	name: ARTIFACT_PACKAGE_NAME,
	version,
	entry: ARTIFACT_LAYOUT.entry,
	webDir: ARTIFACT_LAYOUT.webDir,
	minimumBun: MINIMUM_BUN,
	builtAt: new Date().toISOString(),
	commit: dirty ? `${commit}-dirty` : commit,
};
await writeFile(
	join(pkg, ARTIFACT_LAYOUT.manifest),
	`${JSON.stringify(manifest, null, "\t")}\n`,
);
await writeFile(
	join(pkg, "package.json"),
	`${JSON.stringify(
		{
			name: ARTIFACT_PACKAGE_NAME,
			version,
			description:
				"The self-hosted Opaline server: API, MCP, background jobs and web app, bundled for Bun",
			license: "MIT",
			type: "module",
			main: ARTIFACT_LAYOUT.entry,
			engines: { bun: `>=${MINIMUM_BUN}` },
		},
		null,
		"\t",
	)}\n`,
);
await cp(join(root, "LICENSE"), join(pkg, "LICENSE"));
for (const required of [
	ARTIFACT_LAYOUT.entry,
	join(ARTIFACT_LAYOUT.webDir, "index.html"),
	join(ARTIFACT_LAYOUT.pluginDir, "entry.js"),
	ARTIFACT_LAYOUT.postgresMigrate,
	join(ARTIFACT_LAYOUT.postgresMigrations, "meta/_journal.json"),
])
	if (!existsSync(join(pkg, required)))
		throw new Error(`the artifact is missing ${required}`);

const tarball = await packDirectory(pkg);
const { sha256, integrity } = digests(tarball);
const file = `opaline-server-${version}.tgz`;
await writeFile(join(outDir, file), tarball);
await writeFile(
	join(outDir, `opaline-server-${version}.json`),
	`${JSON.stringify(
		{
			name: ARTIFACT_PACKAGE_NAME,
			version,
			file,
			size: tarball.length,
			sha256,
			integrity,
			minimumBun: MINIMUM_BUN,
			builtAt: manifest.builtAt,
			commit: manifest.commit,
		},
		null,
		"\t",
	)}\n`,
);
await rm(stage, { recursive: true, force: true });
console.log(
	`${join(outDir, file)} (${(tarball.length / 1024 / 1024).toFixed(1)} MiB, sha256 ${sha256})`,
);
