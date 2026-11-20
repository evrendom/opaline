import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	createProgressLine,
	ensureVerifiedDownload,
} from "../../../../packages/local-server/src/download.ts";

// The Electron the app ships with, pinned per target. Sizes and digests are from
// https://github.com/electron/electron/releases/download/v45.2.1/SHASUMS256.txt.
export const ELECTRON_VERSION = "45.2.1";

const PINNED = {
	"darwin-arm64": [
		120_788_457,
		"sha256-qaGgpbZN9xSVf4NGfISCPLNHkiBZIsbxNlULJANgWSI=",
	],
	"darwin-x64": [
		124_990_038,
		"sha256-MIV42TgSlmahZfKjtcng/IZtVT5tU6OMoRS8Ugm3ZfA=",
	],
	"linux-arm64": [
		124_824_562,
		"sha256-4E5jXnMS9LNhZk4YMZrv3byq6/3unI2aUh5SCqjThbs=",
	],
	"linux-x64": [
		123_777_540,
		"sha256-YW78GuR4SvGk8/Dod05z5wMOe9FwjanQm89UPfpJm+s=",
	],
	"win32-arm64": [
		155_942_343,
		"sha256-KyDX2fne7YfQ94pXvgRqRXil6R6ITLTlIBPKFOeToPc=",
	],
	"win32-x64": [
		158_187_314,
		"sha256-fDQq7kXVtMyv5d/pA3AoeWsIJzWlduIeK04thCLrtyc=",
	],
} as const;

export type ElectronTarget = keyof typeof PINNED;

export function electronAsset(target: ElectronTarget) {
	const [size, integrity] = PINNED[target];
	const name = `electron-v${ELECTRON_VERSION}-${target}.zip`;
	return {
		id: name,
		url: `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${name}`,
		size,
		integrity,
	};
}

function unzip(archive: string, into: string) {
	const [command, args] =
		process.platform === "darwin"
			? ["ditto", ["-x", "-k", archive, into]]
			: process.platform === "win32"
				? ["tar", ["-xf", archive, "-C", into]]
				: ["unzip", ["-q", archive, "-d", into]];
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.status !== 0)
		throw new Error(`${command} could not extract ${archive}`);
}

// Downloads (once, verified) and extracts Electron for a target; prints the
// extracted folder (it holds Electron.app on macOS, the electron binary elsewhere).
export async function ensureElectron(cacheDir: string, target: ElectronTarget) {
	const asset = electronAsset(target);
	const extracted = join(cacheDir, `electron-v${ELECTRON_VERSION}-${target}`);
	if (existsSync(join(extracted, ".complete"))) return extracted;
	const progress = createProgressLine(`electron ${asset.id}`);
	const archive = await ensureVerifiedDownload(asset, {
		cacheDir,
		label: "electron",
		onProgress: progress.update,
	});
	progress.finish();
	const partial = `${extracted}.partial`;
	rmSync(partial, { recursive: true, force: true });
	mkdirSync(partial, { recursive: true });
	unzip(archive, partial);
	await Bun.write(join(partial, ".complete"), `${asset.integrity}\n`);
	rmSync(extracted, { recursive: true, force: true });
	renameSync(partial, extracted);
	return extracted;
}

if (import.meta.main) {
	const [cacheDir, target] = process.argv.slice(2);
	if (!cacheDir || !(target in PINNED)) {
		process.stderr.write(
			`usage: bun electron.ts <cache dir> <${Object.keys(PINNED).join("|")}>\n`,
		);
		process.exit(2);
	}
	process.stdout.write(
		`${await ensureElectron(cacheDir, target as ElectronTarget)}\n`,
	);
}
