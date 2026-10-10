/**
 * Writes the fact review page: one self-contained HTML file with the fact
 * catalog side by side (which Claude Code path connects to which Codex
 * path), the JSON outline of each agent's transcripts, and the per-fact
 * review where the product owner marks facts reviewed and answers the open
 * decisions. Nothing in the page is fetched; open the file in a browser.
 *
 *   bun run --cwd packages/api-routes facts:review \
 *     [-- [--census-from <dir-or-file>]... [--out <path>]]
 *
 * The outline comes from a census of `--census-from` (repeatable; read-only,
 * keeps no values but short enum-like ones), by default the transcript-records
 * parser fixtures. The default output, packages/api-routes/.fact-review/
 * index.html, is gitignored.
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { createCensus } from "../session-transcript/transcript-records/fact-census.js";
import {
	addCensusPaths,
	FIXTURE_CORPUS_DIR,
} from "../session-transcript/transcript-records/fact-census-files.js";
import {
	FACT_REVIEW_PATH,
	renderFactReview,
} from "../session-transcript/transcript-records/fact-review.js";

const CATALOG_PATH =
	"packages/api-routes/src/session-transcript/transcript-records/fact-catalog.ts";
const repoRoot = new URL("../../../../", import.meta.url).pathname;

function git(...args: string[]): string {
	const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot });
	return result.success ? result.stdout.toString().trim() : "";
}

function fail(message: string): never {
	process.stderr.write(`${message}\n`);
	process.exit(2);
}

interface Options {
	out: string;
	readonly censusFrom: string[];
}

function parseArgs(argv: readonly string[]): Options {
	const options: Options = {
		out: resolve(repoRoot, FACT_REVIEW_PATH),
		censusFrom: [],
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		const value = argv[index + 1];
		if (arg === "--out" || arg === "--census-from") {
			if (value === undefined || value.startsWith("--"))
				fail(`${arg} needs a path`);
			index++;
			if (arg === "--out") options.out = resolve(process.cwd(), value);
			else options.censusFrom.push(resolve(process.cwd(), value));
		} else fail(`Unknown argument ${arg}`);
	}
	return options;
}

/** A path as the page shows it: repo-relative, or with the home directory as `~`. */
function displayPath(path: string): string {
	const fromRepo = relative(repoRoot, path);
	if (!fromRepo.startsWith("..")) return fromRepo;
	const home = homedir();
	return path.startsWith(`${home}/`) || path === home
		? `~${path.slice(home.length)}`
		: path;
}

const options = parseArgs(process.argv.slice(2));
const roots =
	options.censusFrom.length > 0 ? options.censusFrom : [FIXTURE_CORPUS_DIR];
const census = createCensus();
await addCensusPaths(census, roots);
const label =
	options.censusFrom.length > 0
		? roots.map(displayPath).join(", ")
		: `the transcript-records parser fixtures (${displayPath(FIXTURE_CORPUS_DIR)})`;

const [hash, date] = git(
	"log",
	"-1",
	"--format=%H%x09%cI",
	"--",
	CATALOG_PATH,
).split("\t");
const html = await renderFactReview(
	{
		...(hash && date ? { catalogCommit: { hash, date } } : {}),
		catalogDirty: git("status", "--porcelain", "--", CATALOG_PATH) !== "",
		generatedAt: new Date().toISOString(),
	},
	{ label, census },
);
await mkdir(dirname(options.out), { recursive: true });
await Bun.write(options.out, html);
process.stdout.write(
	`Wrote ${options.out} (${Math.round(html.length / 1024)} KB, census of ${label})\n`,
);
