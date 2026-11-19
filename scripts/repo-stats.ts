import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Row = Record<string, string>;

type Table = {
	readonly columns: readonly string[];
	readonly key: readonly string[];
};

export const TABLES = {
	downloads: {
		columns: ["date", "tag", "asset_id", "asset", "created_at", "downloads"],
		key: ["date", "asset_id"],
	},
	repository: {
		columns: ["date", "stars", "forks", "watchers", "open_issues"],
		key: ["date"],
	},
	views: { columns: ["date", "views", "unique_visitors"], key: ["date"] },
	clones: { columns: ["date", "clones", "unique_cloners"], key: ["date"] },
	referrers: {
		columns: ["date", "referrer", "views", "unique_visitors"],
		key: ["date", "referrer"],
	},
	paths: {
		columns: ["date", "path", "title", "views", "unique_visitors"],
		key: ["date", "path"],
	},
} as const satisfies Record<string, Table>;

export type TableName = keyof typeof TABLES;

export const CHECKS_PER_ACTIVE_DAY = 3;

const API = "https://api.github.com";
const FEED_TAG = "desktop-latest";
const RELEASE_PREFIX = "desktop-v";

const README = `# Repository stats

Written once a day by \`bun scripts/repo-stats.ts snapshot\` from the
public Opaline repository. GitHub keeps traffic for 14 days and resets a
release file's download count when the file is replaced, so these files
are the long-term record. \`bun scripts/repo-stats.ts report --dir <this
folder>\` turns downloads.csv into installs, update rates and active
installs.

| File | One row per | Notes |
|---|---|---|
| downloads.csv | day and release file | running download total of each file on that day; a replaced file gets a new asset_id |
| repository.csv | day | stars, forks, watchers, open issues |
| views.csv | day | page views and unique visitors of the repository |
| clones.csv | day | clones and unique cloners |
| referrers.csv | day and site | the 14 days up to that day, as GitHub reports them |
| paths.csv | day and page | the 14 days up to that day, as GitHub reports them |
`;

export function parseCsv(text: string): Row[] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (quoted) {
			if (character === '"' && text[index + 1] === '"') {
				field += '"';
				index++;
			} else if (character === '"') {
				quoted = false;
			} else {
				field += character;
			}
		} else if (character === '"') {
			quoted = true;
		} else if (character === ",") {
			record.push(field);
			field = "";
		} else if (character === "\n") {
			record.push(field);
			records.push(record);
			record = [];
			field = "";
		} else if (character !== "\r") {
			field += character;
		}
	}
	if (field !== "" || record.length > 0) {
		record.push(field);
		records.push(record);
	}
	const [header, ...body] = records;
	if (!header) return [];
	return body.map((values) =>
		Object.fromEntries(
			header.map((column, index) => [column, values[index] ?? ""]),
		),
	);
}

function csvField(value: string): string {
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(
	columns: readonly string[],
	rows: readonly Row[],
): string {
	const lines = [columns.join(",")];
	for (const row of rows)
		lines.push(columns.map((column) => csvField(row[column] ?? "")).join(","));
	return `${lines.join("\n")}\n`;
}

export function upsert(
	existing: readonly Row[],
	incoming: readonly Row[],
	key: readonly string[],
): Row[] {
	const keyOf = (row: Row) =>
		key.map((column) => row[column] ?? "").join("\u0000");
	const merged = new Map<string, Row>();
	for (const row of existing) merged.set(keyOf(row), row);
	for (const row of incoming) merged.set(keyOf(row), row);
	return [...merged.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([, row]) => row);
}

export function readTable(directory: string, name: TableName): Row[] {
	const path = join(directory, `${name}.csv`);
	return existsSync(path) ? parseCsv(readFileSync(path, "utf8")) : [];
}

export function mergeTable(
	directory: string,
	name: TableName,
	incoming: readonly Row[],
): void {
	if (incoming.length === 0) return;
	const table = TABLES[name];
	const rows = upsert(readTable(directory, name), incoming, table.key);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, `${name}.csv`), toCsv(table.columns, rows));
}

export class GitHubError extends Error {
	constructor(
		readonly status: number,
		path: string,
	) {
		super(`GitHub answered ${status} for ${path}`);
	}
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function client(fetchImpl: Fetch, token: string | undefined) {
	return async <T>(path: string): Promise<T> => {
		const response = await fetchImpl(`${API}${path}`, {
			headers: {
				accept: "application/vnd.github+json",
				"x-github-api-version": "2022-11-28",
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
		});
		if (!response.ok) throw new GitHubError(response.status, path);
		return (await response.json()) as T;
	};
}

type Release = {
	tag_name: string;
	assets: {
		id: number;
		name: string;
		created_at: string;
		download_count: number;
	}[];
};
type Traffic = { timestamp: string; count: number; uniques: number };
type Referrer = { referrer: string; count: number; uniques: number };
type PopularPath = {
	path: string;
	title: string;
	count: number;
	uniques: number;
};
type Repository = {
	stargazers_count: number;
	forks_count: number;
	subscribers_count: number;
	open_issues_count: number;
};

export type SnapshotResult = {
	readonly tables: TableName[];
	readonly warnings: string[];
};

export async function snapshot(options: {
	repository: string;
	directory: string;
	today: string;
	token?: string;
	trafficToken?: string;
	fetch?: Fetch;
}): Promise<SnapshotResult> {
	const fetchImpl = options.fetch ?? fetch;
	const get = client(fetchImpl, options.token);
	const base = `/repos/${options.repository}`;
	const date = options.today;
	const tables: TableName[] = [];
	const warnings: string[] = [];
	mkdirSync(options.directory, { recursive: true });
	writeFileSync(join(options.directory, "README.md"), README);

	const releases: Release[] = [];
	for (let page = 1; ; page++) {
		const batch = await get<Release[]>(
			`${base}/releases?per_page=100&page=${page}`,
		);
		releases.push(...batch);
		if (batch.length < 100) break;
	}
	mergeTable(
		options.directory,
		"downloads",
		releases.flatMap((release) =>
			release.assets.map((asset) => ({
				date,
				tag: release.tag_name,
				asset_id: String(asset.id),
				asset: asset.name,
				created_at: asset.created_at,
				downloads: String(asset.download_count),
			})),
		),
	);
	tables.push("downloads");

	const repository = await get<Repository>(base);
	mergeTable(options.directory, "repository", [
		{
			date,
			stars: String(repository.stargazers_count),
			forks: String(repository.forks_count),
			watchers: String(repository.subscribers_count),
			open_issues: String(repository.open_issues_count),
		},
	]);
	tables.push("repository");

	if (!options.trafficToken) {
		warnings.push(
			"no traffic token, so views, clones, referrers and paths were not saved",
		);
		return { tables, warnings };
	}
	const traffic = client(fetchImpl, options.trafficToken);
	try {
		const views = await traffic<{ views: Traffic[] }>(`${base}/traffic/views`);
		const clones = await traffic<{ clones: Traffic[] }>(
			`${base}/traffic/clones`,
		);
		const referrers = await traffic<Referrer[]>(
			`${base}/traffic/popular/referrers`,
		);
		const paths = await traffic<PopularPath[]>(`${base}/traffic/popular/paths`);
		mergeTable(
			options.directory,
			"views",
			views.views.map((day) => ({
				date: day.timestamp.slice(0, 10),
				views: String(day.count),
				unique_visitors: String(day.uniques),
			})),
		);
		mergeTable(
			options.directory,
			"clones",
			clones.clones.map((day) => ({
				date: day.timestamp.slice(0, 10),
				clones: String(day.count),
				unique_cloners: String(day.uniques),
			})),
		);
		mergeTable(
			options.directory,
			"referrers",
			referrers.map((entry) => ({
				date,
				referrer: entry.referrer,
				views: String(entry.count),
				unique_visitors: String(entry.uniques),
			})),
		);
		mergeTable(
			options.directory,
			"paths",
			paths.map((entry) => ({
				date,
				path: entry.path,
				title: entry.title,
				views: String(entry.count),
				unique_visitors: String(entry.uniques),
			})),
		);
		tables.push("views", "clones", "referrers", "paths");
	} catch (error) {
		if (
			!(error instanceof GitHubError) ||
			(error.status !== 401 && error.status !== 403)
		)
			throw error;
		warnings.push(
			`the traffic token was refused (${error.status}), so traffic was not saved`,
		);
	}
	return { tables, warnings };
}

type AssetHistory = {
	readonly id: string;
	readonly tag: string;
	readonly asset: string;
	readonly createdAt: string;
	readonly counts: { date: string; downloads: number }[];
};

function histories(downloads: readonly Row[]): AssetHistory[] {
	const byId = new Map<string, AssetHistory>();
	for (const row of downloads) {
		const id = row.asset_id ?? "";
		let history = byId.get(id);
		if (!history) {
			history = {
				id,
				tag: row.tag ?? "",
				asset: row.asset ?? "",
				createdAt: row.created_at ?? "",
				counts: [],
			};
			byId.set(id, history);
		}
		history.counts.push({
			date: row.date ?? "",
			downloads: Number(row.downloads ?? 0),
		});
	}
	for (const history of byId.values())
		history.counts.sort((a, b) => a.date.localeCompare(b.date));
	return [...byId.values()];
}

function latest(history: AssetHistory, onOrBefore?: string): number {
	let value = 0;
	for (const count of history.counts) {
		if (onOrBefore !== undefined && count.date > onOrBefore) break;
		value = Math.max(value, count.downloads);
	}
	return value;
}

export type Report = {
	readonly installs: number;
	readonly releases: {
		tag: string;
		date: string;
		updates: number;
		installsBefore: number;
		updateRate: number | null;
	}[];
	readonly checks: { date: string; checks: number; activeEstimate: number }[];
};

export function buildReport(downloads: readonly Row[]): Report {
	const all = histories(downloads);
	const dmgs = all.filter((history) => history.asset.endsWith(".dmg"));
	const installsOn = (date: string) =>
		dmgs.reduce((sum, history) => sum + latest(history, date), 0);

	const releases = all
		.filter(
			(history) =>
				history.tag.startsWith(RELEASE_PREFIX) &&
				history.asset.endsWith(".zip"),
		)
		.map((history) => {
			const date = history.createdAt.slice(0, 10);
			const before = installsOn(date);
			const updates = latest(history);
			return {
				tag: history.tag,
				date,
				updates,
				installsBefore: before,
				updateRate: before > 0 ? updates / before : null,
			};
		})
		.sort((a, b) => a.date.localeCompare(b.date));

	const perDay = new Map<string, number>();
	for (const history of all) {
		if (history.tag !== FEED_TAG || !history.asset.endsWith(".json")) continue;
		for (let index = 1; index < history.counts.length; index++) {
			const previous = history.counts[index - 1];
			const current = history.counts[index];
			if (!previous || !current) continue;
			perDay.set(
				current.date,
				(perDay.get(current.date) ?? 0) +
					Math.max(0, current.downloads - previous.downloads),
			);
		}
	}
	const checks = [...perDay.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, count]) => ({
			date,
			checks: count,
			activeEstimate: Math.round(count / CHECKS_PER_ACTIVE_DAY),
		}));

	return {
		installs: dmgs.reduce((sum, history) => sum + latest(history), 0),
		releases,
		checks,
	};
}

export function formatReport(report: Report): string {
	const lines = [`Installs (DMG downloads, all time): ${report.installs}`, ""];
	lines.push(
		"Updates per release (zip downloads / installs before the release):",
	);
	if (report.releases.length === 0) lines.push("  no desktop releases yet");
	for (const release of report.releases) {
		const rate =
			release.updateRate === null
				? "n/a"
				: `${Math.round(release.updateRate * 100)}%`;
		lines.push(
			`  ${release.tag}  ${release.date}  ${release.updates} of ${release.installsBefore}  ${rate}`,
		);
	}
	lines.push(
		"",
		`Active installs per day (feed checks / ${CHECKS_PER_ACTIVE_DAY}, an estimate):`,
	);
	if (report.checks.length === 0)
		lines.push("  needs two daily snapshots of the update feed");
	for (const day of report.checks.slice(-14)) {
		lines.push(`  ${day.date}  ~${day.activeEstimate}  (${day.checks} checks)`);
	}
	return `${lines.join("\n")}\n`;
}

function option(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(`--${name}`);
	return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: readonly string[]): Promise<void> {
	const [command] = args;
	const directory = option(args, "dir") ?? "stats";
	if (command === "snapshot") {
		const result = await snapshot({
			repository:
				option(args, "repo") ??
				process.env.GITHUB_REPOSITORY ??
				"evrendom/opaline",
			directory,
			today: new Date().toISOString().slice(0, 10),
			token: process.env.GITHUB_TOKEN,
			trafficToken: process.env.REPO_STATS_TOKEN || undefined,
		});
		for (const warning of result.warnings)
			console.warn(`::warning::${warning}`);
		console.log(`saved ${result.tables.join(", ")} to ${directory}`);
		return;
	}
	if (command === "report") {
		process.stdout.write(
			formatReport(buildReport(readTable(directory, "downloads"))),
		);
		return;
	}
	console.error(
		"usage: bun scripts/repo-stats.ts snapshot|report [--dir stats] [--repo owner/name]",
	);
	process.exit(2);
}

if (import.meta.main) await main(process.argv.slice(2));
