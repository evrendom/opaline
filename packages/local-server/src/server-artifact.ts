import { createHash, randomUUID } from "node:crypto";
import {
	createReadStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { type DownloadProgress, ensureVerifiedDownload } from "./download.js";
import { isLoopbackHostname, sanitizeForTerminalDisplay } from "./safe-url.js";
import { extractTarGz } from "./tar-extract.js";

export const SERVER_PACKAGE_NAME = "@opalinehq/server";
export const SERVER_ARTIFACT_ENV = "OPALINE_SERVER_ARTIFACT";
export const SERVER_ARTIFACT_SHA256_ENV = "OPALINE_SERVER_ARTIFACT_SHA256";
export const NPM_REGISTRY_ENV = "OPALINE_NPM_REGISTRY";
export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";
export const SERVER_MANIFEST_FILE = "opaline-server.json";
export const INSTALL_MARKER_FILE = ".opaline-install.json";

const PACKAGE_PREFIX = "package";
const REGISTRY_TIMEOUT_MS = 30_000;
const VERSION_PATTERN =
	/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const PackagedManifestSchema = z.object({
	name: z.literal(SERVER_PACKAGE_NAME),
	version: z.string().regex(VERSION_PATTERN),
	entry: z.string().min(1),
	webDir: z.string().min(1),
	minimumBun: z
		.string()
		.regex(/^\d+\.\d+\.\d+$/u)
		.optional(),
	builtAt: z.string().optional(),
	commit: z.string().optional(),
});

const ArtifactManifestSchema = z.object({
	name: z.literal(SERVER_PACKAGE_NAME),
	version: z.string().regex(VERSION_PATTERN),
	file: z.string().regex(/^[A-Za-z0-9._+-]+\.tgz$/u),
	size: z.number().int().positive().optional(),
	sha256: z.string().regex(SHA256_PATTERN),
	integrity: z
		.string()
		.regex(/^sha512-[A-Za-z0-9+/]+=*$/u)
		.optional(),
});

const InstallMarkerSchema = z.object({
	version: z.string().regex(VERSION_PATTERN),
	sha256: z.string().regex(SHA256_PATTERN),
	integrity: z.string(),
	source: z.string(),
	installedAt: z.string(),
});

const NpmVersionSchema = z.object({
	version: z.string(),
	dist: z.object({
		tarball: z.string(),
		integrity: z.string().optional(),
		shasum: z.string().optional(),
	}),
});

type PackagedManifest = z.infer<typeof PackagedManifestSchema>;
type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;
type InstallMarker = z.infer<typeof InstallMarkerSchema>;

export interface ServerArtifactContext {
	readonly dataDir: string;
	readonly env: NodeJS.ProcessEnv;
	readonly cliVersion: string;
	readonly log: (line: string) => void;
	readonly progress?: (label: string) => {
		update: (progress: DownloadProgress) => void;
		finish: () => void;
	};
	readonly fetchImpl?: typeof fetch;
	readonly currentInstall?: string;
}

export interface PreparedServerArtifact {
	readonly version: string;
	readonly sha256: string;
	readonly source: string;
	readonly installDir: string;
	readonly entry: string;
	readonly webDir: string;
	readonly hasWebBuild: boolean;
	readonly minimumBun: string | undefined;
	readonly reused: boolean;
	install(): void;
	discard(): void;
}

interface Expectation {
	readonly version?: string;
	readonly sha256: string;
	readonly integrity: string;
	readonly source: string;
}

export function getServerInstallRoot(dataDir: string): string {
	return join(dataDir, "server");
}

export async function prepareServerArtifact(
	context: ServerArtifactContext,
): Promise<PreparedServerArtifact> {
	const configured = context.env[SERVER_ARTIFACT_ENV]?.trim();
	const envSha256 = readSha256Env(context.env);
	if (!configured) return prepareFromNpm(context);
	if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(configured))
		return prepareFromUrl(context, configured, envSha256);
	return prepareFromPath(context, configured, envSha256);
}

export function readInstalledServer(
	directory: string,
): { marker: InstallMarker; manifest: PackagedManifest } | undefined {
	try {
		const marker = InstallMarkerSchema.parse(
			JSON.parse(readFileSync(join(directory, INSTALL_MARKER_FILE), "utf8")),
		);
		const manifest = readPackagedManifest(directory);
		if (marker.version !== manifest.version) return undefined;
		const entry = insideDirectory(directory, manifest.entry, "entry");
		if (!existsSync(entry) || !statSync(entry).isFile()) return undefined;
		return { marker, manifest };
	} catch {
		return undefined;
	}
}

export function pruneServerInstalls(
	dataDir: string,
	keep: readonly string[],
): string[] {
	const root = getServerInstallRoot(dataDir);
	if (!existsSync(root)) return [];
	const removed: string[] = [];
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (name.startsWith(".staging-") || name.startsWith(".replaced-")) {
			rmSync(path, { recursive: true, force: true });
			continue;
		}
		if (name.startsWith(".") || keep.includes(name)) continue;
		if (!existsSync(join(path, INSTALL_MARKER_FILE))) continue;
		rmSync(path, { recursive: true, force: true });
		removed.push(name);
	}
	return removed;
}

export function compareServerVersions(left: string, right: string): number {
	const parse = (value: string) => {
		const [core = "", prerelease] = value.split("+")[0]?.split(/-(.*)/su) ?? [];
		return {
			parts: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
			prerelease,
		};
	};
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index++) {
		const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	if (a.prerelease === b.prerelease) return 0;
	if (a.prerelease === undefined) return 1;
	if (b.prerelease === undefined) return -1;
	return a.prerelease < b.prerelease ? -1 : 1;
}

async function prepareFromPath(
	context: ServerArtifactContext,
	configured: string,
	envSha256: string | undefined,
): Promise<PreparedServerArtifact> {
	const path = resolve(configured);
	if (!existsSync(path))
		throw new Error(`${SERVER_ARTIFACT_ENV}=${configured} does not exist.`);
	const root = getServerInstallRoot(context.dataDir);
	if (statSync(path).isDirectory()) {
		const installed = isDirectChild(root, path)
			? readInstalledServer(path)
			: undefined;
		if (!installed)
			throw new Error(
				`${SERVER_ARTIFACT_ENV}=${configured} is a directory. Point it at a server artifact (.tgz with its .json manifest), or at a version this CLI installed under ${root}.`,
			);
		return fromInstalled(path, installed, installed.marker.source);
	}
	let manifest: ArtifactManifest | undefined;
	let tarball = path;
	if (path.endsWith(".json")) {
		manifest = readArtifactManifest(path);
		tarball = join(dirname(path), manifest.file);
		if (!existsSync(tarball))
			throw new Error(
				`${path} describes ${manifest.file}, which is not next to it.`,
			);
	} else {
		const sibling = siblingManifestPath(path);
		if (sibling && existsSync(sibling)) {
			manifest = readArtifactManifest(sibling);
			if (manifest.file !== basename(path))
				throw new Error(
					`${sibling} describes ${manifest.file}, not ${basename(path)}.`,
				);
		}
	}
	const expectedSha256 = agreeOnSha256(manifest?.sha256, envSha256);
	if (!expectedSha256)
		throw new Error(
			`No checksum for ${tarball}: keep the .json manifest that \`bun run build:selfhost\` writes next to it, or set ${SERVER_ARTIFACT_SHA256_ENV}.`,
		);
	const digests = await digestFile(tarball);
	if (manifest?.size !== undefined && statSync(tarball).size !== manifest.size)
		throw new Error(
			`${tarball} is ${statSync(tarball).size} bytes; its manifest says ${manifest.size}.`,
		);
	if (digests.sha256 !== expectedSha256)
		throw new Error(
			`${tarball} does not match its checksum (sha256 ${digests.sha256}, expected ${expectedSha256}).`,
		);
	if (manifest?.integrity && manifest.integrity !== digests.integrity)
		throw new Error(`${tarball} does not match the integrity in its manifest.`);
	const expectation: Expectation = {
		version: manifest?.version,
		sha256: digests.sha256,
		integrity: digests.integrity,
		source: `artifact ${tarball}`,
	};
	const reused = findInstalled(
		root,
		(marker) => marker.sha256 === digests.sha256,
	);
	if (reused) return fromInstalled(reused.path, reused, expectation.source);
	return stageArtifact(context, tarball, expectation);
}

async function prepareFromUrl(
	context: ServerArtifactContext,
	configured: string,
	envSha256: string | undefined,
): Promise<PreparedServerArtifact> {
	const url = readDownloadUrl(configured, SERVER_ARTIFACT_ENV);
	const fetchImpl = context.fetchImpl ?? fetch;
	let manifest: ArtifactManifest | undefined;
	let tarballUrl = url;
	if (url.pathname.endsWith(".json")) {
		const fetched = await fetchJson(fetchImpl, url);
		if (fetched === undefined)
			throw new Error(`${redactUrl(url)} answered 404.`);
		manifest = parseArtifactManifest(fetched, redactUrl(url));
		tarballUrl = new URL(manifest.file, url);
	} else {
		const siblingPath = siblingManifestPath(url.pathname);
		if (siblingPath) {
			const siblingUrl = new URL(url);
			siblingUrl.pathname = siblingPath;
			const fetched = await fetchJson(fetchImpl, siblingUrl);
			if (fetched !== undefined) {
				manifest = parseArtifactManifest(fetched, redactUrl(siblingUrl));
				if (manifest.file !== basename(url.pathname))
					throw new Error(
						`${redactUrl(siblingUrl)} describes ${manifest.file}, not ${basename(url.pathname)}.`,
					);
			}
		}
	}
	const expectedSha256 = agreeOnSha256(manifest?.sha256, envSha256);
	if (!expectedSha256)
		throw new Error(
			`No checksum for ${redactUrl(tarballUrl)}: publish the .json manifest next to it, or set ${SERVER_ARTIFACT_SHA256_ENV}.`,
		);
	const source = `artifact ${redactUrl(tarballUrl)}`;
	const root = getServerInstallRoot(context.dataDir);
	const reused = findInstalled(
		root,
		(marker) => marker.sha256 === expectedSha256,
	);
	if (reused) return fromInstalled(reused.path, reused, source);
	const download = await downloadArtifact(context, {
		id: `opaline-server-${expectedSha256.slice(0, 16)}.tgz`,
		url: tarballUrl.href,
		size: manifest?.size,
		integrity: `sha256-${Buffer.from(expectedSha256, "hex").toString("base64")}`,
	});
	try {
		const digests = await digestFile(download.path);
		if (manifest?.integrity && manifest.integrity !== digests.integrity)
			throw new Error(
				`${redactUrl(tarballUrl)} does not match the integrity in its manifest.`,
			);
		return await stageArtifact(context, download.path, {
			version: manifest?.version,
			sha256: digests.sha256,
			integrity: digests.integrity,
			source,
		});
	} finally {
		download.release();
	}
}

async function prepareFromNpm(
	context: ServerArtifactContext,
): Promise<PreparedServerArtifact> {
	const registry = readDownloadUrl(
		context.env[NPM_REGISTRY_ENV]?.trim() || DEFAULT_NPM_REGISTRY,
		NPM_REGISTRY_ENV,
	);
	const version = context.cliVersion;
	const spec = `${SERVER_PACKAGE_NAME}@${version}`;
	const source = `npm ${spec}`;
	const root = getServerInstallRoot(context.dataDir);
	const metadataUrl = new URL(
		`${registry.href.replace(/\/+$/u, "")}/${SERVER_PACKAGE_NAME.replace("/", "%2f")}/${encodeURIComponent(version)}`,
	);
	const current = () => {
		const directory = context.currentInstall;
		if (!directory || !isDirectChild(root, directory)) return undefined;
		const installed = readInstalledServer(directory);
		return installed
			? fromInstalled(directory, installed, installed.marker.source)
			: undefined;
	};
	let metadata: unknown;
	try {
		metadata = await fetchJson(context.fetchImpl ?? fetch, metadataUrl);
	} catch (error) {
		const installed = findInstalled(
			root,
			(marker) => marker.version === version && marker.source === source,
		);
		const fallback = installed
			? fromInstalled(installed.path, installed, source)
			: current();
		if (fallback) {
			context.log(
				`Could not reach ${registry.host} (${asMessage(error)}); starting the installed Opaline server ${fallback.version}.`,
			);
			return fallback;
		}
		throw new Error(
			`Could not reach ${registry.host} to download ${spec}: ${asMessage(error)}`,
		);
	}
	if (metadata === undefined) {
		const fallback = current();
		if (fallback) {
			context.log(
				`${spec} is not published on npm yet; starting the installed Opaline server ${fallback.version} (${fallback.source}). Set ${SERVER_ARTIFACT_ENV} to install another one.`,
			);
			return fallback;
		}
		throw new Error(
			`${spec} is not published on npm yet, so this CLI cannot download the Opaline server. Set ${SERVER_ARTIFACT_ENV} to a server artifact (the .tgz that \`bun run build:selfhost\` writes in the server repository, with its .json manifest next to it), or OPALINE_SERVER_DIR to a server checkout.`,
		);
	}
	const parsed = NpmVersionSchema.safeParse(metadata);
	if (!parsed.success)
		throw new Error(`${registry.host} returned unusable metadata for ${spec}.`);
	const { dist } = parsed.data;
	if (parsed.data.version !== version)
		throw new Error(
			`${registry.host} returned ${parsed.data.version} for ${spec}.`,
		);
	if (!dist.integrity?.startsWith("sha512-"))
		throw new Error(
			`${registry.host} has no sha512 integrity for ${spec}; refusing to install it.`,
		);
	const integrity = dist.integrity;
	const reused = findInstalled(
		root,
		(marker) => marker.integrity === integrity,
	);
	if (reused) return fromInstalled(reused.path, reused, source);
	const tarballUrl = readDownloadUrl(dist.tarball, `${spec} tarball`);
	const download = await downloadArtifact(context, {
		id: `opaline-server-${version}-${Buffer.from(integrity.slice(7), "base64").toString("hex").slice(0, 16)}.tgz`,
		url: tarballUrl.href,
		integrity,
	});
	try {
		const digests = await digestFile(download.path);
		if (dist.shasum && dist.shasum.toLowerCase() !== digests.sha1)
			throw new Error(
				`The ${spec} download does not match its published shasum.`,
			);
		return await stageArtifact(context, download.path, {
			version,
			sha256: digests.sha256,
			integrity: digests.integrity,
			source,
		});
	} finally {
		download.release();
	}
}

async function stageArtifact(
	context: ServerArtifactContext,
	tarball: string,
	expectation: Expectation,
): Promise<PreparedServerArtifact> {
	const root = getServerInstallRoot(context.dataDir);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const staging = join(root, `.staging-${randomUUID()}`);
	let manifest: PackagedManifest;
	let hasWebBuild = false;
	try {
		await extractTarGz(tarball, {
			prefix: PACKAGE_PREFIX,
			destination: staging,
		});
		manifest = readPackagedManifest(staging);
		if (expectation.version && manifest.version !== expectation.version)
			throw new Error(
				`The artifact contains server ${manifest.version}, expected ${expectation.version}.`,
			);
		const entry = insideDirectory(staging, manifest.entry, "entry");
		if (!existsSync(entry) || !statSync(entry).isFile())
			throw new Error(`The artifact has no ${manifest.entry}.`);
		hasWebBuild = existsSync(
			join(insideDirectory(staging, manifest.webDir, "webDir"), "index.html"),
		);
		const marker: InstallMarker = {
			version: manifest.version,
			sha256: expectation.sha256,
			integrity: expectation.integrity,
			source: expectation.source,
			installedAt: new Date().toISOString(),
		};
		writeFileSync(
			join(staging, INSTALL_MARKER_FILE),
			`${JSON.stringify(marker, null, 2)}\n`,
			{ mode: 0o644 },
		);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw new Error(
			`Could not unpack the Opaline server from ${expectation.source.replace(/^\w+ /u, "")}: ${asMessage(error)}`,
		);
	}
	const installDir = join(root, manifest.version);
	return {
		version: manifest.version,
		sha256: expectation.sha256,
		source: expectation.source,
		installDir,
		entry: join(installDir, manifest.entry),
		webDir: join(installDir, manifest.webDir),
		hasWebBuild,
		minimumBun: manifest.minimumBun,
		reused: false,
		install() {
			if (!existsSync(staging)) return;
			if (!existsSync(installDir)) {
				renameSync(staging, installDir);
				return;
			}
			const aside = join(root, `.replaced-${randomUUID()}`);
			renameSync(installDir, aside);
			renameSync(staging, installDir);
			rmSync(aside, { recursive: true, force: true });
		},
		discard() {
			rmSync(staging, { recursive: true, force: true });
		},
	};
}

function fromInstalled(
	installDir: string,
	installed: { marker: InstallMarker; manifest: PackagedManifest },
	source: string,
): PreparedServerArtifact {
	return {
		version: installed.manifest.version,
		sha256: installed.marker.sha256,
		source,
		installDir,
		entry: join(installDir, installed.manifest.entry),
		webDir: join(installDir, installed.manifest.webDir),
		hasWebBuild: existsSync(
			join(installDir, installed.manifest.webDir, "index.html"),
		),
		minimumBun: installed.manifest.minimumBun,
		reused: true,
		install() {},
		discard() {},
	};
}

function findInstalled(
	root: string,
	matches: (marker: InstallMarker) => boolean,
):
	| { path: string; marker: InstallMarker; manifest: PackagedManifest }
	| undefined {
	if (!existsSync(root)) return undefined;
	for (const name of readdirSync(root)) {
		if (name.startsWith(".")) continue;
		const path = join(root, name);
		const installed = readInstalledServer(path);
		if (
			installed &&
			installed.marker.version === name &&
			matches(installed.marker)
		)
			return { path, ...installed };
	}
	return undefined;
}

function readPackagedManifest(directory: string): PackagedManifest {
	const path = join(directory, SERVER_MANIFEST_FILE);
	if (!existsSync(path)) throw new Error(`there is no ${SERVER_MANIFEST_FILE}`);
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error(`${SERVER_MANIFEST_FILE} is not valid JSON`);
	}
	const parsed = PackagedManifestSchema.safeParse(value);
	if (!parsed.success)
		throw new Error(
			`${SERVER_MANIFEST_FILE} is not an Opaline server manifest (${describeIssue(parsed.error)})`,
		);
	const packageJson = join(directory, "package.json");
	if (existsSync(packageJson)) {
		const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as {
			name?: unknown;
			version?: unknown;
		};
		if (pkg.name !== parsed.data.name || pkg.version !== parsed.data.version)
			throw new Error(
				`package.json (${String(pkg.name)}@${String(pkg.version)}) does not match ${SERVER_MANIFEST_FILE} (${parsed.data.name}@${parsed.data.version})`,
			);
	}
	return parsed.data;
}

function readArtifactManifest(path: string): ArtifactManifest {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error(`${path} is not valid JSON.`);
	}
	return parseArtifactManifest(value, path);
}

function parseArtifactManifest(
	value: unknown,
	label: string,
): ArtifactManifest {
	const parsed = ArtifactManifestSchema.safeParse(value);
	if (!parsed.success)
		throw new Error(
			`${label} is not an Opaline server artifact manifest (${describeIssue(parsed.error)}).`,
		);
	return parsed.data;
}

function isDirectChild(root: string, path: string): boolean {
	try {
		return realpathSync(dirname(path)) === realpathSync(root);
	} catch {
		return false;
	}
}

function siblingManifestPath(path: string): string | undefined {
	return path.endsWith(".tgz") ? `${path.slice(0, -4)}.json` : undefined;
}

function agreeOnSha256(
	fromManifest: string | undefined,
	fromEnv: string | undefined,
): string | undefined {
	if (fromManifest && fromEnv && fromManifest !== fromEnv)
		throw new Error(
			`${SERVER_ARTIFACT_SHA256_ENV} (${fromEnv}) disagrees with the artifact manifest (${fromManifest}).`,
		);
	return fromEnv ?? fromManifest;
}

function readSha256Env(env: NodeJS.ProcessEnv): string | undefined {
	const value = env[SERVER_ARTIFACT_SHA256_ENV]?.trim().toLowerCase();
	if (!value) return undefined;
	if (!SHA256_PATTERN.test(value))
		throw new Error(
			`${SERVER_ARTIFACT_SHA256_ENV} must be a sha256 in hex (64 characters).`,
		);
	return value;
}

function readDownloadUrl(value: string, label: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(
			`${label} ${sanitizeForTerminalDisplay(value)} is not a URL.`,
		);
	}
	if (url.protocol === "https:") return url;
	if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return url;
	throw new Error(
		`${label} must be an https:// URL (http:// only for this machine), not ${redactUrl(url)}.`,
	);
}

async function fetchJson(
	fetchImpl: typeof fetch,
	url: URL,
): Promise<unknown | undefined> {
	const response = await fetchImpl(url, {
		headers: { Accept: "application/json" },
		redirect: "follow",
		signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
	});
	if (response.status === 404) {
		await response.body?.cancel();
		return undefined;
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`HTTP ${response.status} from ${url.host}`);
	}
	try {
		return await response.json();
	} catch {
		throw new Error(`${redactUrl(url)} did not return JSON.`);
	}
}

async function downloadArtifact(
	context: ServerArtifactContext,
	asset: { id: string; url: string; size?: number; integrity: string },
): Promise<{ path: string; release: () => void }> {
	const shared = context.env.OPALINE_DOWNLOAD_CACHE?.trim();
	const cacheDir =
		shared || join(getServerInstallRoot(context.dataDir), ".downloads");
	const label = "Opaline server";
	const progress = context.progress?.(`Downloading ${label}`);
	try {
		const path = await ensureVerifiedDownload(asset, {
			cacheDir,
			label,
			onProgress: progress?.update,
			fetchImpl: context.fetchImpl,
		});
		return {
			path,
			release: () => {
				if (!shared) rmSync(path, { force: true });
			},
		};
	} finally {
		progress?.finish();
	}
}

async function digestFile(
	path: string,
): Promise<{ sha256: string; integrity: string; sha1: string }> {
	const sha256 = createHash("sha256");
	const sha512 = createHash("sha512");
	const sha1 = createHash("sha1");
	for await (const chunk of createReadStream(path)) {
		sha256.update(chunk);
		sha512.update(chunk);
		sha1.update(chunk);
	}
	return {
		sha256: sha256.digest("hex"),
		integrity: `sha512-${sha512.digest("base64")}`,
		sha1: sha1.digest("hex"),
	};
}

function insideDirectory(root: string, path: string, label: string): string {
	if (isAbsolute(path) || path.split(/[\\/]/u).includes(".."))
		throw new Error(
			`${SERVER_MANIFEST_FILE} ${label} ${path} is not inside the artifact`,
		);
	const resolved = resolve(root, path);
	if (!resolved.startsWith(`${resolve(root)}${sep}`))
		throw new Error(
			`${SERVER_MANIFEST_FILE} ${label} ${path} is not inside the artifact`,
		);
	return resolved;
}

function redactUrl(url: URL): string {
	const copy = new URL(url);
	copy.username = "";
	copy.password = "";
	copy.search = "";
	return copy.href;
}

function describeIssue(error: z.ZodError): string {
	const issue = error.issues[0];
	return issue
		? `${issue.path.join(".") || "value"}: ${issue.message}`
		: "invalid";
}

function asMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
