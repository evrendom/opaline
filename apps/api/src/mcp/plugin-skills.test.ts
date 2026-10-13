import { expect, test } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";
import {
	prepareAgentSql,
	type SqlWindow,
} from "../services/analysis/sql-guard.js";
import { SQL_VIEWS } from "../services/analysis/sql-views.js";

const SKILLS = join(import.meta.dir, "../../../../plugins/opaline/skills");

test("every plugin skill's front matter is valid YAML with a name and a description", async () => {
	const files = [...new Glob("*/SKILL.md").scanSync(SKILLS)].sort();
	expect(files).toEqual(["opaline/SKILL.md", "setup/SKILL.md"]);
	for (const file of files) {
		const text = await Bun.file(join(SKILLS, file)).text();
		const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
		expect({ file, frontMatter: Boolean(match) }).toEqual({
			file,
			frontMatter: true,
		});
		const parsed = Bun.YAML.parse(match?.[1] ?? "") as Record<string, unknown>;
		expect({
			file,
			name: typeof parsed.name,
			description: typeof parsed.description,
		}).toEqual({ file, name: "string", description: "string" });
		expect(`${parsed.description}`.length).toBeGreaterThan(20);
	}
});

const PLUGIN = join(import.meta.dir, "../../../../plugins/opaline");

test("the Claude Code manifest matches the Codex manifest", async () => {
	const codex = await Bun.file(
		join(PLUGIN, ".codex-plugin/plugin.json"),
	).json();
	const claude = await Bun.file(
		join(PLUGIN, ".claude-plugin/plugin.json"),
	).json();
	for (const key of ["name", "version", "description", "license"]) {
		expect({ key, value: claude[key] }).toEqual({ key, value: codex[key] });
	}
});

test("the Claude Code marketplace lists the plugin", async () => {
	const marketplace = await Bun.file(
		join(PLUGIN, "../../.claude-plugin/marketplace.json"),
	).json();
	expect(marketplace.plugins).toContainEqual(
		expect.objectContaining({ name: "opaline", source: "./plugins/opaline" }),
	);
});

/** Phrases that tell the agent a member sees only their own sessions. */
const OWN_SESSIONS_ONLY =
	/(their|your) own sessions|members:? (see |analyze |count )?(only )?their own|admins (all|see|count|can analyze)|admins: the whole team|only session owners and workspace admins/i;

test("no skill or manifest says members see only their own sessions; answers still never single out or rank people", async () => {
	const texts = [
		...[...new Glob("*/SKILL.md").scanSync(SKILLS)].map((file) =>
			join(SKILLS, file),
		),
		join(PLUGIN, ".codex-plugin/plugin.json"),
		join(PLUGIN, ".claude-plugin/plugin.json"),
	];
	const claims: [string, string][] = [];
	for (const path of texts) {
		const match = (await Bun.file(path).text()).match(OWN_SESSIONS_ONLY);
		if (match) claims.push([path.slice(PLUGIN.length), match[0]]);
	}
	expect(claims).toEqual([]);
	const skill = await Bun.file(join(SKILLS, "opaline/SKILL.md")).text();
	expect(skill).toContain("Every member sees every member's sessions");
	expect(skill).toContain("Don't single out or rank people");
});

/** The SQL examples of the opaline skill: every ```sql block. */
async function skillSqlExamples(): Promise<string[]> {
	const skill = await Bun.file(join(SKILLS, "opaline/SKILL.md")).text();
	return [...skill.matchAll(/```sql\n([\s\S]*?)```/gu)].map(
		(match) => match[1] ?? "",
	);
}

/** The columns `search('…')` gives a query, as the search statement selects them. */
const SEARCH_COLUMNS = [
	"run_id",
	"user_id",
	"session_id",
	"agent_id",
	"turn_idx",
	"started_at",
	"score",
	"why",
	"snippet",
];

const KEYWORDS = new Set(
	"select from where and or not in as join left inner on using group by order desc asc limit having with is null interval day distinct case when then else end between like ilike all true false".split(
		" ",
	),
);

/**
 * The column names an example uses that no view it reads has, and the
 * aliases it gives a column's name: each
 * name that is not a keyword, a function, a view, a WITH name or an alias
 * the query defines must be a column of a view it reads (of that view, when
 * qualified by its alias).
 */
function columnProblems(sql: string): string[] {
	const text = sql.replace(/'(?:[^'\\]|\\.|'')*'/gu, "''");
	const views = new Map(SQL_VIEWS.map((view) => [view.name, view]));
	const columnsOf = new Map<string, readonly string[]>();
	const read: string[] = [];
	for (const match of text.matchAll(
		/\b(?:from|join)\s+(\w+)(\s*\([^)]*\))?(?:\s+as)?(?:\s+(\w+))?/giu,
	)) {
		const [, table = "", call, alias] = match;
		const columns =
			call && table.toLowerCase() === "search"
				? SEARCH_COLUMNS
				: views.get(table.toLowerCase())?.columns.map((column) => column.name);
		if (!columns) continue;
		read.push(...columns);
		columnsOf.set(table.toLowerCase(), columns);
		if (alias && !KEYWORDS.has(alias.toLowerCase()))
			columnsOf.set(alias.toLowerCase(), columns);
	}
	const defined = new Set(
		[
			...text.matchAll(/\bas\s+(\w+)/giu),
			...text.matchAll(/\bwith\s+(\w+)\s+as\s*\(/giu),
		].map((match) => (match[1] ?? "").toLowerCase()),
	);
	const unknown: string[] = [];
	for (const match of text.matchAll(/\b([a-z_]\w*)(?:\.(\w+))?\b(\s*\()?/giu)) {
		const [name, first = "", second, call] = match;
		const lower = first.toLowerCase();
		if (call || KEYWORDS.has(lower)) continue;
		if (second !== undefined) {
			const columns = columnsOf.get(lower);
			if (!columns?.includes(second)) unknown.push(name);
			continue;
		}
		if (views.has(lower) || defined.has(lower) || lower === "search") continue;
		if (!read.includes(first)) unknown.push(name);
	}
	// ClickHouse resolves a name to the query's alias before the column, so
	// sum(cost_usd) AS cost_usd breaks countIf(cost_usd IS NULL) beside it.
	for (const alias of defined)
		if (read.includes(alias))
			unknown.push(`${alias} (an alias named like a column)`);
	return unknown;
}

test("every SQL example in the skill passes the sql guard and names only columns of the views it reads, never as an alias", async () => {
	const examples = await skillSqlExamples();
	expect(examples.length).toBeGreaterThanOrEqual(6);
	const views = new Map(
		SQL_VIEWS.map((view) => [
			view.name,
			{
				windowColumn: view.windowColumn,
				statement: (window: SqlWindow) => view.sql(false, window),
			},
		]),
	);
	const search = new Map([["search", () => ({ sql: "SELECT 1" })]]);
	const refused = examples.flatMap((sql) => {
		const prepared = prepareAgentSql(sql, views, new Set(), search);
		return prepared.ok ? [] : [{ sql, failure: prepared.failure.message }];
	});
	expect(refused).toEqual([]);
	expect(
		examples
			.map((sql) => ({ sql, unknown: columnProblems(sql) }))
			.filter(({ unknown }) => unknown.length > 0),
	).toEqual([]);
});

test("the column check catches a column no view it reads has, and an alias named like a column", () => {
	expect(
		columnProblems(
			"SELECT r.run_id, r.lost_minutes, s.why, cost_usd FROM search('x') AS s JOIN runs AS r USING (run_id) WHERE r.agent_id = ''",
		),
	).toEqual(["r.lost_minutes"]);
	expect(columnProblems("SELECT time_lost FROM calls")).toEqual(["time_lost"]);
	expect(
		columnProblems(
			"SELECT round(sum(cost_usd), 2) AS cost_usd, countIf(cost_usd IS NULL) AS unpriced FROM runs",
		),
	).toEqual(["cost_usd (an alias named like a column)"]);
});
