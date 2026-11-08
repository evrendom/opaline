import {
	type AstNode,
	column,
	DAY_MS,
	literalStrings,
	parse,
	type Scope,
	scopeOf,
	Tree,
	windowOf,
} from "./sql-ast.js";

export interface SqlTraps {
	readonly notices: readonly string[];
	readonly counted: readonly string[];
}

const STREAM_VIEWS = new Set(["calls", "setup_files", "prompts", "events"]);
const PATH_COLUMNS = new Set(["file_path", "changed_files"]);
const TEXT_COLUMNS = new Set([
	"command",
	"command_head",
	"output",
	"error",
	"text",
	"prompt_head",
	"final_message",
	"denial_reason",
	"hook_command",
]);
const TEXT_MATCH =
	/^(like|ilike|notlike|notilike|match|multimatch|multisearch|position|locate|extract|countmatches|countsubstrings|hastoken)/u;
const PATH_MATCH =
	/^(like|ilike|match|startswith|endswith|position|locate|multimatch|multisearch|equals|in|has|hasany|hasall)$/u;
const ARRAY_FUNCTIONS = /^array[a-z]*$/u;
const COUNTED = /^(count|sum|uniq)/iu;
const NAMED = /[\p{L}\p{N}_\-.~)\]+}]/u;
const LONG_WINDOW_DAYS = 14;
const TIME_BUCKET =
	/^(date|todate(32|time(64)?)?|tostartof\w+|toyyyymm\w*|tomonday|to(iso|year)?week|formatdatetime\w*|date_?trunc|timeslot)$/u;
const RATE = /^(divide|intdiv(orzero)?|avg\w*)$/u;

function isMainStream(tree: Tree, node: AstNode): boolean {
	if (node.kind !== "Function") return false;
	const args = tree.args(node);
	const agent = args.some((arg) => column(arg) === "agent_id");
	const blank = args.some(
		(arg) =>
			arg.kind === "Literal" &&
			literalStrings(arg).length > 0 &&
			literalStrings(arg).every((value) => value === ""),
	);
	if ((node.name === "equals" || node.name === "in") && agent && blank)
		return true;
	if (node.name === "empty" && agent) return true;
	if (node.name === "not")
		return args.some(
			(arg) =>
				arg.kind === "Function" &&
				arg.name === "notEmpty" &&
				tree.args(arg).some((inner) => column(inner) === "agent_id"),
		);
	if (node.name === "equals") {
		const length = args.find(
			(arg) => arg.kind === "Function" && /^length/u.test(arg.name),
		);
		return (
			length !== undefined &&
			tree.args(length).some((inner) => column(inner) === "agent_id") &&
			args.some((arg) => arg.kind === "Literal" && /_0$/u.test(arg.name))
		);
	}
	return false;
}

function namesDirectory(value: string, prefix: boolean): boolean {
	const bare = value.replace(/^\^/u, "");
	if (prefix && (bare.startsWith("/") || bare.startsWith("~"))) return true;
	for (let i = 1; i < value.length; i++)
		if (value[i] === "/" && NAMED.test(value[i - 1] ?? "")) return true;
	return false;
}

function pathMatch(tree: Tree, node: AstNode): string | null {
	const name = node.name.toLowerCase();
	if (node.kind !== "Function" || !PATH_MATCH.test(name)) return null;
	const above = tree.ancestors(node);
	if (above.some((up) => up.kind === "Function" && up.name === "not"))
		return null;
	const [first, ...rest] = tree.args(node);
	const onPath =
		tree.reads(first, PATH_COLUMNS) ||
		above.some(
			(up) =>
				up.kind === "Function" &&
				ARRAY_FUNCTIONS.test(up.name.toLowerCase()) &&
				tree.args(up).some((arg) => PATH_COLUMNS.has(column(arg))),
		);
	if (!onPath) return null;
	const prefix =
		name === "startswith" ||
		name === "match" ||
		name === "like" ||
		name === "ilike";
	for (const arg of rest)
		for (const value of literalStrings(arg)) {
			const anchored =
				prefix &&
				(name === "startswith" ||
					value.startsWith("^") ||
					(name !== "match" && !value.startsWith("%")));
			if (namesDirectory(value, anchored)) return value;
		}
	return null;
}

function textMatch(tree: Tree, node: AstNode): string | null {
	if (node.kind !== "Function" || !TEXT_MATCH.test(node.name.toLowerCase()))
		return null;
	const [first] = tree.args(node);
	if (!first) return null;
	const named = [first, ...tree.descendants(first)].find(
		(item) => item.kind === "Identifier" && TEXT_COLUMNS.has(column(item)),
	);
	return named ? column(named) : null;
}

function longTextMatch(
	tree: Tree,
	now: number,
): { column: string; span: string } | null {
	for (const node of tree.nodes) {
		const name = textMatch(tree, node);
		if (!name) continue;
		const select = tree.ancestors(node).find((up) => up.kind === "SelectQuery");
		if (!select) continue;
		const window = windowOf(tree, scopeOf(tree, select), now);
		if (window.from === null) {
			if (window.known) return { column: name, span: "with no time filter" };
			continue;
		}
		const days = ((window.to ?? now) - window.from) / DAY_MS;
		if (days > LONG_WINDOW_DAYS)
			return { column: name, span: `over ${Math.round(days)} days` };
	}
	return null;
}

function calls(tree: Tree, node: AstNode | undefined, pattern: RegExp) {
	return node
		? [node, ...tree.descendants(node, true)].some(
				(item) =>
					item.kind === "Function" && pattern.test(item.name.toLowerCase()),
			)
		: false;
}

function rateWithoutCount(tree: Tree, scope: Scope, outer: Scope): boolean {
	const listed = (of: Scope) =>
		of.list?.children.flatMap((child) => tree.at(child) ?? []) ?? [];
	const items = listed(scope);
	const named = (node: AstNode) => {
		const name = node.kind === "Identifier" ? node.name.split(".").at(-1) : "";
		if (!name) return node;
		const alias = (item: AstNode) => item.alias === name;
		return items.find(alias) ?? tree.nodes.find(alias) ?? node;
	};
	const keys = scope.groups.map((key) => {
		const position =
			key.kind === "Literal" ? /^UInt64_(\d+)$/u.exec(key.name) : null;
		return position ? items[Number(position[1]) - 1] : named(key);
	});
	if (!keys.some((key) => calls(tree, key, TIME_BUCKET))) return false;
	const rate = items.some(
		(item) => !keys.includes(item) && calls(tree, item, RATE),
	);
	const counted = [scope, outer].some((of) =>
		listed(of).some((item) => {
			const shown = named(item);
			return shown.kind === "Function" && shown.name.toLowerCase() === "count";
		}),
	);
	return rate && !counted;
}

function quoted(value: string): string {
	return `'${value.length > 40 ? `${value.slice(0, 39)}…` : value}'`;
}

export function sqlTraps(
	explain: readonly string[],
	now: Date = new Date(),
): SqlTraps {
	const tree = new Tree(parse(explain));
	const selects = tree.nodes.filter((node) => node.kind === "SelectQuery");
	const scopes = selects.map((select) => scopeOf(tree, select));
	const withBodies = tree.nodes
		.filter((node) => node.kind === "WithElement")
		.flatMap((node) => tree.descendants(node))
		.filter((node) => node.kind === "TableIdentifier")
		.map((node) => node.name.toLowerCase());
	const viewsOf = (scope: Scope) =>
		scope.tables.flatMap((table) =>
			STREAM_VIEWS.has(table)
				? [table]
				: withBodies.filter((name) => STREAM_VIEWS.has(name)),
		);
	const notices: string[] = [];
	const mainOnly = scopes.find(
		(scope) =>
			viewsOf(scope).length > 0 &&
			scope.filters.some((filter) => isMainStream(tree, filter)),
	);
	if (mainOnly)
		notices.push(
			`check: agent_id = '' keeps only the main stream of ${[...new Set(viewsOf(mainOnly))].join(", ")}, so subagent streams are left out. To say whether an agent read, saw or ran something, count every stream (drop that filter).`,
		);
	const path = tree.nodes
		.map((node) => pathMatch(tree, node))
		.find((value) => value !== null);
	if (path)
		notices.push(
			`check: a path is matched by a directory (${quoted(path)}). A shell path after cd ~/… can be relative, so match the end of the path instead, e.g. match(file_path, '(^|/)AGENTS\\.md$').`,
		);
	const long = longTextMatch(tree, now.getTime());
	if (long)
		notices.push(
			`check: a LIKE or regex on ${long.column} ${long.span} matches loosely and can pass the limits; keep each query to ${LONG_WINDOW_DAYS} days or less (or use search('…', 'exact', days)) and read some matching runs before counting them.`,
		);
	const top = scopes[0];
	if (top && scopes.some((scope) => rateWithoutCount(tree, scope, top)))
		notices.push(
			"check: rates per time bucket are shown without the row count behind them. Add count() per bucket and say which buckets are thin; a bucket with no rows is missing from the result, not 0.",
		);
	const counted = top?.list
		? top.list.children
				.flatMap((child) => tree.at(child) ?? [])
				.filter((item) => item.kind === "Function" && COUNTED.test(item.name))
				.flatMap((item) =>
					item.alias
						? [item.alias]
						: item.name === "count" && tree.args(item).length === 0
							? ["count()"]
							: [],
				)
		: [];
	return { notices, counted };
}

export function resultNotices(
	traps: SqlTraps,
	rows: readonly Record<string, unknown>[],
): string[] {
	if (rows.length === 0)
		return [
			"check: no rows. Before saying none happened, confirm with a broader query: every stream (no agent_id filter), paths matched by their end, a longer window, or search('…', 'exact').",
		];
	const zero = traps.counted.filter((name) =>
		rows.every((row) => {
			const value = row[name];
			return value !== null && value !== undefined && Number(value) === 0;
		}),
	);
	return zero.length > 0
		? [
				`check: ${zero.join(", ")} ${zero.length > 1 ? "are" : "is"} 0 in every row. Before saying none or 0 of N, confirm with a broader query (every stream, paths matched by their end, search('…', 'exact')) and read a run that should match.`,
			]
		: [];
}
