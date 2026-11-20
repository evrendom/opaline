import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Folders macOS guards with a privacy prompt ("Opaline would like to access
 * files in your Documents folder"). The ingest reads only the agents' own
 * transcript folders on its own; a session whose project lives in one of
 * these is stored from what its transcript records, so importing never asks.
 */
const HOME_FOLDERS = [
	"Desktop",
	"Documents",
	"Downloads",
	"Library/CloudStorage",
	"Library/Mobile Documents",
	"Movies",
	"Music",
	"Pictures",
];

export function protectedFolders(
	home: string = homedir(),
	platform: NodeJS.Platform = process.platform,
): readonly string[] {
	if (platform !== "darwin") return [];
	return [...HOME_FOLDERS.map((folder) => resolve(home, folder)), "/Volumes"];
}

const folders = protectedFolders();

export function isProtectedPath(
	path: string,
	guarded: readonly string[] = folders,
): boolean {
	const target = resolve(path).toLowerCase();
	return guarded.some((folder) => {
		const root = folder.toLowerCase();
		return target === root || target.startsWith(`${root}/`);
	});
}

/** Claude Code names a project folder by its path with every other character turned into "-". */
export function encodesProtectedPath(
	encodedDirectory: string,
	guarded: readonly string[] = folders,
): boolean {
	const encoded = encodedDirectory.toLowerCase();
	return guarded.some((folder) => {
		const root = folder.replace(/[^A-Za-z0-9]/gu, "-").toLowerCase();
		return encoded === root || encoded.startsWith(`${root}-`);
	});
}
