import { expect, test } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";
import { RETRO_TOOLS_OFF } from "../services/analysis/retro-tools.js";
import {
	prepareAgentSql,
	type SqlWindow,
} from "../services/analysis/sql-guard.js";
import { SQL_VIEWS } from "../services/analysis/sql-views.js";

const SKILLS = join(import.meta.dir, "../../../../../plugin/skills");

async function opalineSkillText(): Promise<string> {
	const files = [...new Glob("opaline/*.md").scanSync(SKILLS)].sort();
	const texts = await Promise.all(
		files.map((file) => Bun.file(join(SKILLS, file)).text()),
	);
	return texts.join("\n\n");
}

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

const PLUGIN = join(import.meta.dir, "../../../../../plugin");

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

/** Phrases that tell the agent a member sees only their own sessions. */
const OWN_SESSIONS_ONLY =
	/(their|your) own sessions|members:? (see |analyze |count )?(only )?their own|admins (all|see|count|can analyze)|admins: the whole team|only session owners and workspace admins/i;

test("no skill or manifest says members see only their own sessions", async () => {
	const texts = [
		...[...new Glob("*/*.md").scanSync(SKILLS)].map((file) =>
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
});

/** The SQL examples of the opaline skill: every ```sql block. */
async function skillSqlExamples(): Promise<string[]> {
	const skill = await opalineSkillText();
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

interface ListedInput {
	properties: Record<
		string,
		{
			enum?: string[];
			default?: unknown;
			maximum?: number;
			maxItems?: number;
			description: string;
			items?: { enum?: string[] };
		}
	>;
}

/**
 * The find and read tools as tools/list publishes them, and every tool name.
 * MCP_TOOLS loads in a child process because the module opens the Postgres
 * pool on import (without connecting).
 */
async function publishedTools(): Promise<{
	names: string[];
	find: ListedInput;
	read: ListedInput;
}> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS, listedTool } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const input = (name) => listedTool(MCP_TOOLS.find((tool) => tool.name === name)).inputSchema;
console.log(JSON.stringify({ names: MCP_TOOLS.map((tool) => tool.name), find: input("find"), read: input("read") }));`,
		],
		{
			env: {
				PATH: process.env.PATH,
				PG_CONNECTION_STRING: "postgres://unused@127.0.0.1:1/unused",
			},
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		subprocess.exited,
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
	]);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	return JSON.parse(stdout);
}

/** The skill's classic flow, its own file beside SKILL.md. */
async function classicFlow(): Promise<string> {
	const classic = await Bun.file(join(SKILLS, "opaline/classic.md")).text();
	expect(classic).toStartWith("# Classic flow (find and read)");
	return classic;
}

test("the skill calls schema first and, on the server's refusal, follows the classic flow instead of the retro tools", async () => {
	const skill = await Bun.file(join(SKILLS, "opaline/SKILL.md")).text();
	const refusal = "the retro tools are not enabled for this workspace yet";
	expect(RETRO_TOOLS_OFF.toLowerCase()).toContain(refusal);
	expect(RETRO_TOOLS_OFF).toContain("use find and read");
	const gate = skill.indexOf("**Call `schema` first.**");
	expect(gate).toBeGreaterThan(-1);
	// Near the top: before the tools are described.
	expect(gate).toBeLessThan(skill.indexOf("## Which tool for what"));
	const paragraph = skill.slice(gate, skill.indexOf("\n\n", gate));
	expect(paragraph).toContain(refusal);
	expect(paragraph).toContain("`classic.md`");
	for (const tool of [
		"sql",
		"search",
		"run",
		"estimate_questions",
		"run_questions",
	])
		expect({ tool, named: paragraph.includes(`\`${tool}\``) }).toEqual({
			tool,
			named: true,
		});
	expect(await classicFlow()).toContain("`find`");
});

test("the classic flow names every find source, groupBy, sort and kind, and read's depths and limits, as the tools publish them", async () => {
	const [{ names, find, read }, section] = await Promise.all([
		publishedTools(),
		classicFlow(),
	]);
	const missing = (values: readonly string[], format: (v: string) => string) =>
		values.filter((value) => !section.includes(format(value)));
	const enumOf = (input: ListedInput, key: string) =>
		input.properties[key]?.enum ?? input.properties[key]?.items?.enum ?? [];

	expect(missing(enumOf(find, "source"), (v) => `\`source=${v}\``)).toEqual([]);
	expect(missing(enumOf(find, "groupBy"), (v) => v)).toEqual([]);
	expect(missing(enumOf(find, "sort"), (v) => v)).toEqual([]);
	expect(missing(enumOf(find, "kind"), (v) => v)).toEqual([]);
	expect(missing(enumOf(find, "reaction"), (v) => `\`reaction=${v}\``)).toEqual(
		[],
	);
	expect(section).toContain(`\`limit\` 1-${find.properties.limit?.maximum}`);
	const limitDefaults = /Default (\d+), or (\d+) for source=tool/u.exec(
		find.properties.limit?.description ?? "",
	);
	expect(limitDefaults).not.toBeNull();
	expect(section).toContain(
		`default ${limitDefaults?.[1]}, ${limitDefaults?.[2]} for \`source=tool\``,
	);

	expect(missing(enumOf(read, "depth"), (v) => `\`depth=${v}\``)).toEqual([]);
	expect(section).toContain(
		`\`depth=${read.properties.depth?.default}\` (default)`,
	);
	expect(section).toContain(`1-${read.properties.refs?.maxItems} runs`);
	expect(section).toContain(
		`default ${read.properties.maxChars?.default}, max ${read.properties.maxChars?.maximum}`,
	);

	// Every argument the section names with a value is one the tools take.
	const named = [...section.matchAll(/`(\w+)=/gu)].map((match) => match[1]);
	const accepted = new Set([
		...Object.keys(find.properties),
		...Object.keys(read.properties),
		"action",
	]);
	expect(named.filter((name) => name && !accepted.has(name))).toEqual([]);
	// And every tool it names in backticks exists.
	const tools = [...section.matchAll(/`([a-z_]+)`/gu)]
		.map((match) => match[1] ?? "")
		.filter((name) => /^(find|read|answers|[a-z]+_[a-z_]+)$/u.test(name));
	expect(tools.filter((name) => !names.includes(name))).toEqual([]);
});
