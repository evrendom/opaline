import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const retiredOutputPaths = [
	"design-archive",
	"__DO_NOT_MERGE__inspiration",
	"vendor/attio-dashboard",
	"vendor/lens-content",
	"fonts/attio",
	"wrapped-skills-issue-emoji.jpg",
	"favicon.svg",
	"vendor/lens-canvas/hero-poster.png",
];

export async function checkSiteArchive(output: string): Promise<void> {
	for (const path of retiredOutputPaths) {
		if (existsSync(join(output, path))) {
			throw new Error(`Archived design content reached the site output: ${path}`);
		}
	}
	await checkDirectories(output);
}

async function checkDirectories(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) {
			throw new Error(`Unexpected symlink in site output: ${entry.name}`);
		}
		if (!entry.isDirectory()) continue;
		if (
			entry.name === "design-archive" ||
			entry.name === "__DO_NOT_MERGE__inspiration"
		) {
			throw new Error("Archived design directory reached the site output");
		}
		await checkDirectories(join(directory, entry.name));
	}
}
