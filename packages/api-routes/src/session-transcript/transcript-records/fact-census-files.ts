import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { type Census, type CensusAgent, censusStream } from "./fact-census.js";

/**
 * Reading transcript files into a census (fact-census.ts), for the
 * `facts:census` and `facts:review` scripts and the tests. Read-only.
 */

/** The transcript-records parser fixtures: the default census corpus. */
export const FIXTURE_CORPUS_DIR = new URL("../__fixtures__", import.meta.url)
	.pathname;

/** Every `.jsonl` file under a file or directory, in name order. */
export async function* jsonlFiles(path: string): AsyncGenerator<string> {
	const info = await stat(path);
	if (info.isFile()) {
		yield path;
		return;
	}
	const entries = await readdir(path, { withFileTypes: true });
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) yield* jsonlFiles(child);
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield child;
	}
}

/** Feed one file to the census line by line, without holding it in memory. */
export async function addCensusFile(
	census: Census,
	path: string,
	agent?: CensusAgent,
): Promise<void> {
	const filename = basename(path, ".jsonl");
	const sessionId =
		/(?:^|[-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(
			filename,
		)?.[1];
	const agentId = /^agent-(.+)$/u.exec(filename)?.[1];
	const addLine = censusStream(census, agent, {
		...(sessionId === undefined ? {} : { sessionId }),
		...(agentId === undefined ? {} : { agentId, isSidechain: true }),
	});
	const decoder = new TextDecoder();
	let pending = "";
	const reader = Bun.file(path).stream().getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		pending += decoder.decode(value, { stream: true });
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) addLine(line);
	}
	addLine(pending + decoder.decode());
}

/** Add every `.jsonl` file under the given files and directories. */
export async function addCensusPaths(
	census: Census,
	roots: readonly string[],
	agent?: CensusAgent,
): Promise<void> {
	for (const root of roots)
		for await (const file of jsonlFiles(resolve(root)))
			await addCensusFile(census, file, agent);
}
