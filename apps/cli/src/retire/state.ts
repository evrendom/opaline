import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Removed before anything else, so every released hook stops uploading. */
export const CREDENTIALS_FILE = "credentials.json";

/**
 * Everything the released CLI kept in its configuration directory for the
 * cloud. Only these names are removed: the directory may be shared (for
 * example OPALINE_CONFIG_DIR=~/.opaline, where the Mac app keeps `server/`).
 * Kept on purpose: `logs/`, `auto-upload.json` (it lists the project folders
 * whose hooks a later run must still find), `runtime/` (the retired runtime
 * that cleans up any hook that comes back) and the `.auto-upload-lock`.
 */
export const STATE_FILES = [
	"analysis-markers.json",
	"claude-task-output-sweep.json",
	"failed-uploads.json",
	"installation-id.json",
	"product-analytics.json",
	"projects.json",
	"remote-cache.json",
	"repository-evidence-pause.json",
	"session-inventory-cache.json",
	"session-inventory.json",
	"upload-installation-id",
] as const;

export const STATE_DIRECTORIES = [
	"analysis-markers.lock",
	"live-sessions",
	"repo-context-spool",
	"repository-evidence-image-backlog",
	"repository-evidence-images",
	"repository-evidence-leases",
	"repository-evidence-pending",
	"repository-evidence-sources",
	"session-inventory.lease",
	"transcript-revisions",
	"upload-capabilities",
] as const;

const TEMPORARY_FILE = new RegExp(
	`^(?:(?:${[CREDENTIALS_FILE, ...STATE_FILES].map(escapeRegExp).join("|")})\\..+|\\.auto-upload-[0-9a-f-]+)\\.tmp$`,
	"u",
);

export function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export function removeCredentials(configDir: string): boolean {
	const path = join(configDir, CREDENTIALS_FILE);
	if (!exists(path)) return false;
	rmSync(path, { force: true });
	return true;
}

/** Removes the named cloud state; returns the names that were present. */
export function removeState(configDir: string): string[] {
	if (!isDirectory(configDir)) return [];
	const removed: string[] = [];
	const names = [
		...STATE_FILES,
		...STATE_DIRECTORIES,
		...readdirSync(configDir).filter((name) => TEMPORARY_FILE.test(name)),
	];
	for (const name of names) {
		const path = join(configDir, name);
		if (!exists(path)) continue;
		try {
			rmSync(path, { recursive: true, force: true, maxRetries: 2 });
			removed.push(name);
		} catch {
			// An older process may still be writing here; the next run retries.
		}
	}
	return removed;
}

export type RuntimeRefresh = "absent" | "current" | "refreshed" | "failed";

/**
 * Replaces an installed hook runtime with this release when this release is
 * newer, so any hook that still points at it cleans up instead of uploading.
 * A runtime is never created where none was installed.
 */
export function refreshRuntime(
	configDir: string,
	bundlePath: string | undefined,
): RuntimeRefresh {
	const runtime = join(configDir, "runtime", "cli.js");
	if (!exists(runtime)) return "absent";
	if (!bundlePath) return "current";
	try {
		const content = readFileSync(bundlePath, "utf8");
		const candidate = readBundleVersion(content);
		if (!candidate) return "failed";
		const installed = readBundleVersion(readFileSync(runtime, "utf8"));
		if (installed && compareVersions(installed, candidate) >= 0)
			return "current";
		mkdirSync(dirname(runtime), { recursive: true, mode: 0o700 });
		writeFileSync(
			join(dirname(runtime), "package.json"),
			'{"type":"module"}\n',
			{
				mode: 0o600,
			},
		);
		const temporary = `${runtime}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
			renameSync(temporary, runtime);
		} finally {
			rmSync(temporary, { force: true });
		}
		return "refreshed";
	} catch {
		return "failed";
	}
}

/**
 * A directory a hook points at is treated as an Opaline configuration
 * directory only when it holds a released Opaline runtime, so a hook with an
 * unusual path can never make the cleanup delete names in an unrelated folder.
 */
export function isCliConfigDir(configDir: string): boolean {
	try {
		const content = readFileSync(join(configDir, "runtime", "cli.js"), "utf8");
		return /\bname:\s*"(?:@opalinehq\/cli|rudel|opaline)",\s*version:\s*"[^"]+"/u.test(
			content,
		);
	} catch {
		return false;
	}
}

/** Bun bundles embed the package manifest; released updaters read it the same way. */
export function readBundleVersion(content: string): string | undefined {
	return /\bname:\s*"@opalinehq\/cli",\s*version:\s*"([^"]+)"/u.exec(
		content,
	)?.[1];
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/u;

export function compareVersions(left: string, right: string): number {
	const a = VERSION.exec(left);
	const b = VERSION.exec(right);
	if (!a || !b) return a ? 1 : b ? -1 : 0;
	for (let i = 1; i <= 3; i++) {
		const difference = BigInt(a[i] ?? "0") - BigInt(b[i] ?? "0");
		if (difference) return difference > 0n ? 1 : -1;
	}
	if (a[4] === b[4]) return 0;
	if (a[4] === undefined) return 1;
	if (b[4] === undefined) return -1;
	const ap = a[4].split(".");
	const bp = b[4].split(".");
	for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
		const x = ap[i];
		const y = bp[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		if (x === y) continue;
		const xn = /^\d+$/u.test(x);
		const yn = /^\d+$/u.test(y);
		if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1;
		if (xn !== yn) return xn ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}

function exists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return existsSync(path);
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
