export interface AstNode {
	readonly index: number;
	readonly depth: number;
	readonly kind: string;
	readonly name: string;
	readonly alias: string | null;
	readonly parent: number | null;
	readonly children: number[];
}

const TIME_COLUMNS = new Set([
	"started_at",
	"ended_at",
	"finished_at",
	"at",
	"observed_at",
	"session_date",
	"received_at",
	"captured_at",
]);
export const DAY_MS = 86_400_000;

export function parse(explain: readonly string[]): AstNode[] {
	const nodes: AstNode[] = [];
	const open: number[] = [];
	for (const raw of explain) {
		const line = raw.trimStart();
		if (!line) continue;
		const depth = raw.length - line.length;
		const space = line.indexOf(" ");
		const kind = space === -1 ? line : line.slice(0, space);
		let rest = space === -1 ? "" : line.slice(space + 1);
		rest = rest.replace(/ \(children \d+\)$/u, "");
		const aliased = / \(alias ([^()\s]+)\)$/u.exec(rest);
		if (aliased) rest = rest.slice(0, aliased.index);
		while (open.length > 0 && (nodes[open.at(-1) ?? 0]?.depth ?? 0) >= depth)
			open.pop();
		const parent = open.at(-1) ?? null;
		const node: AstNode = {
			index: nodes.length,
			depth,
			kind,
			name: rest,
			alias: aliased?.[1] ?? null,
			parent,
			children: [],
		};
		nodes.push(node);
		if (parent !== null) nodes[parent]?.children.push(node.index);
		open.push(node.index);
	}
	return nodes;
}

function unquote(text: string): string {
	let out = "";
	for (let i = 1; i < text.length - 1; i++) {
		const char = text[i];
		if (char === "\\" && i + 1 < text.length - 1) {
			out += text[i + 1];
			i++;
		} else out += char;
	}
	return out;
}

export function literalStrings(node: AstNode | undefined): string[] {
	if (node?.kind !== "Literal") return [];
	if (node.name.startsWith("'")) return [unquote(node.name)];
	return [...node.name.matchAll(/'(?:[^'\\]|\\.)*'/gu)].map((m) =>
		unquote(m[0]),
	);
}

export function column(node: AstNode | undefined): string {
	return node?.kind === "Identifier"
		? (node.name.split(".").at(-1) ?? "").toLowerCase()
		: "";
}

export class Tree {
	constructor(readonly nodes: readonly AstNode[]) {}

	at(index: number | null | undefined): AstNode | undefined {
		return index === null || index === undefined
			? undefined
			: this.nodes[index];
	}

	args(node: AstNode | undefined): AstNode[] {
		const list = this.at(node?.children[0]);
		return list?.kind === "ExpressionList"
			? list.children.flatMap((child) => this.at(child) ?? [])
			: [];
	}

	descendants(node: AstNode, scoped = false): AstNode[] {
		const found: AstNode[] = [];
		const stack = [...node.children].reverse();
		while (stack.length) {
			const next = this.at(stack.pop());
			if (!next) continue;
			found.push(next);
			if (scoped && (next.kind === "Subquery" || next.kind === "SelectQuery"))
				continue;
			stack.push(...[...next.children].reverse());
		}
		return found;
	}

	reads(node: AstNode | undefined, names: ReadonlySet<string>): boolean {
		return node
			? [node, ...this.descendants(node)].some(
					(item) => item.kind === "Identifier" && names.has(column(item)),
				)
			: false;
	}

	ancestors(node: AstNode): AstNode[] {
		const found: AstNode[] = [];
		let next = this.at(node.parent);
		while (next) {
			found.push(next);
			next = this.at(next.parent);
		}
		return found;
	}

	conjuncts(node: AstNode | undefined): AstNode[] {
		if (!node) return [];
		return node.kind === "Function" && node.name === "and"
			? this.args(node).flatMap((arg) => this.conjuncts(arg))
			: [node];
	}
}

export interface Scope {
	readonly select: AstNode;
	readonly list: AstNode | undefined;
	readonly tables: string[];
	readonly filters: AstNode[];
	readonly groups: AstNode[];
}

export function scopeOf(tree: Tree, select: AstNode): Scope {
	const children = select.children.flatMap((child) => tree.at(child) ?? []);
	const tablesAt = children.findIndex(
		(child) => child.kind === "TablesInSelectQuery",
	);
	const lists = children.filter((child) => child.kind === "ExpressionList");
	const list =
		tablesAt > 0
			? children[tablesAt - 1]
			: ((lists.length > 1 ? lists[1] : lists[0]) ?? undefined);
	const tableNode = tablesAt === -1 ? undefined : children[tablesAt];
	const inTables = tableNode ? tree.descendants(tableNode, true) : [];
	const tables = inTables
		.filter((node) => node.kind === "TableIdentifier")
		.map((node) => node.name.toLowerCase());
	const joins = inTables
		.filter((node) => node.kind === "TableJoin")
		.flatMap((node) => node.children.flatMap((child) => tree.at(child) ?? []));
	const after = tablesAt === -1 ? [] : children.slice(tablesAt + 1);
	const end = after.findIndex((child) => child.kind === "ExpressionList");
	const filters = [...(end === -1 ? after : after.slice(0, end)), ...joins];
	const keys = after[end]?.children.flatMap((child) => tree.at(child) ?? []);
	const groups =
		keys?.some((key) => key.kind === "OrderByElement") === false ? keys : [];
	return {
		select,
		list: list?.kind === "ExpressionList" ? list : undefined,
		tables,
		filters: filters.flatMap((filter) => tree.conjuncts(filter)),
		groups,
	};
}

function dateOf(text: string): number | null {
	const match =
		/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?/u.exec(
			text,
		);
	if (!match) return null;
	const time = Date.parse(`${match[1]}T${match[2] ?? "00:00:00"}Z`);
	return Number.isNaN(time) ? null : time;
}

const INTERVAL_MS: Readonly<Record<string, number>> = {
	toIntervalSecond: 1_000,
	toIntervalMinute: 60_000,
	toIntervalHour: 3_600_000,
	toIntervalDay: DAY_MS,
	toIntervalWeek: 7 * DAY_MS,
	toIntervalMonth: 30 * DAY_MS,
	toIntervalQuarter: 91 * DAY_MS,
	toIntervalYear: 365 * DAY_MS,
};
const SHIFT_MS: Readonly<Record<string, number>> = {
	subtractHours: 3_600_000,
	subtractDays: DAY_MS,
	subtractWeeks: 7 * DAY_MS,
	subtractMonths: 30 * DAY_MS,
	subtractYears: 365 * DAY_MS,
};

function numberOf(node: AstNode | undefined): number | null {
	const found =
		node?.kind === "Literal" ? /_(-?\d+(?:\.\d+)?)$/u.exec(node.name) : null;
	return found ? Number(found[1]) : null;
}

function timeOf(
	tree: Tree,
	node: AstNode | undefined,
	now: number,
): { at: number; days: boolean } | null {
	if (!node) return null;
	if (node.kind === "Literal") {
		const [text] = literalStrings(node);
		const at = text === undefined ? null : dateOf(text);
		return at === null ? null : { at, days: false };
	}
	if (node.kind !== "Function") return null;
	const args = tree.args(node);
	if (/^(now|now64|today|yesterday)$/u.test(node.name)) {
		const today = now - (now % DAY_MS);
		return node.name === "today"
			? { at: today, days: true }
			: node.name === "yesterday"
				? { at: today - DAY_MS, days: true }
				: { at: now, days: false };
	}
	if (/^(to(Date|DateTime)|toStartOf|parseDateTime)/u.test(node.name))
		return timeOf(tree, args[0], now);
	const shift = SHIFT_MS[node.name];
	if (shift !== undefined) {
		const base = timeOf(tree, args[0], now);
		const amount = numberOf(args[1]);
		return base && amount !== null
			? { at: base.at - amount * shift, days: base.days }
			: null;
	}
	if (node.name === "minus" || node.name === "plus") {
		const base = timeOf(tree, args[0], now);
		const by = args[1];
		if (!base || !by) return null;
		const interval = by.kind === "Function" ? INTERVAL_MS[by.name] : undefined;
		const amount =
			interval !== undefined
				? (numberOf(tree.args(by)[0]) ?? Number.NaN) * interval
				: (numberOf(by) ?? Number.NaN) * (base.days ? DAY_MS : 1_000);
		if (Number.isNaN(amount)) return null;
		return {
			at: node.name === "minus" ? base.at - amount : base.at + amount,
			days: base.days,
		};
	}
	return null;
}

export type Window = { from: number | null; to: number | null; known: boolean };

export function windowOf(tree: Tree, scope: Scope, now: number): Window {
	let from: number | null = null;
	let to: number | null = null;
	let known = true;
	let scoped = false;
	for (const filter of scope.filters) {
		if (filter.kind !== "Function") continue;
		const [left, right] = tree.args(filter);
		const lower =
			filter.name === "greaterOrEquals" || filter.name === "greater";
		const upper = filter.name === "lessOrEquals" || filter.name === "less";
		if ((lower || upper) && left && right) {
			const timeLeft = TIME_COLUMNS.has(column(left));
			const timeRight = TIME_COLUMNS.has(column(right));
			if (!timeLeft && !timeRight) continue;
			const bound = timeOf(tree, timeLeft ? right : left, now);
			if (!bound) {
				known = false;
				continue;
			}
			if (lower === timeLeft) from = Math.max(from ?? bound.at, bound.at);
			else to = Math.min(to ?? bound.at, bound.at);
			continue;
		}
		if (filter.name === "equals" || filter.name === "in") {
			const target = column(left);
			if (target !== "session_id" && target !== "run_id") continue;
			if (right?.kind === "Literal") scoped = true;
			else if (right?.kind === "Subquery" && from === null) {
				const inner = tree
					.descendants(right)
					.find((node) => node.kind === "SelectQuery");
				if (inner) {
					const window = windowOf(tree, scopeOf(tree, inner), now);
					if (window.from !== null) from = window.from;
					else if (!window.known) known = false;
				}
			}
		}
	}
	return scoped ? { from: now, to: now, known: true } : { from, to, known };
}
