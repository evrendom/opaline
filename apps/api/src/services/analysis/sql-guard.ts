/**
 * Checks an agent's SQL and puts the server's views in place of their names
 * (docs/adr/0005-agents-query-l1-with-sql.md). The agent's text is never
 * concatenated with a filter: it is tokenized, every table it reads must be an
 * allowed view (or a WITH subquery it defines), and each view name is replaced
 * by the view's statement, which binds the workspace and member as query
 * parameters. ClickHouse runs the result read-only (`readonly = 1`), so a write
 * or a settings change fails there too.
 *
 * A view with a window column reads first only what the agent's WHERE keeps
 * of that column's range, when its conditions say so for certain
 * (`windowOf`); the rows are the same, the reads fewer.
 *
 * The server may offer table functions (`search('…')`): a call in a FROM
 * or JOIN position with literal arguments only is replaced by the statement
 * the server gives for it, which binds its own parameters.
 *
 * Refused: anything but one SELECT (or WITH … SELECT); tables, databases and
 * table functions other than the views and the server's, and the names of server tables and
 * databases anywhere; any function not on the function list
 * (`sql-functions.ts`, fail closed), quoted or not; query parameters;
 * SETTINGS, FORMAT and INTO OUTFILE; and naming the workspace column.
 */

import { FUNCTION_LIST_HINT, isAllowedFunction } from "./sql-functions.js";

export interface SqlFailure {
	/** recoverable: fix the query and retry. fatal: refused, do not retry. */
	readonly kind: "recoverable" | "fatal";
	readonly message: string;
	/** The failing part of the agent's SQL, when one can be named. */
	readonly fragment: string | null;
	readonly fix: string;
}

export interface PreparedSql {
	/** The statement ClickHouse runs. */
	readonly sql: string;
	/** Names of the WITH subqueries the agent defines. */
	readonly ctes: ReadonlySet<string>;
	/** The agent's SQL as tokenized, without comments or replacements, for ClickHouse to parse. */
	readonly parsed: {
		readonly sql: string;
		originOf(offset: number): number;
	};
	/** Offset in the agent's SQL of a character of `sql`. */
	originOf(offset: number): number;
	/** The server table functions the query calls, in order. */
	readonly calls: readonly SqlTableFunctionCall[];
}

/**
 * A range the agent's query keeps of a view's window column, as SQL
 * expressions of constants from its WHERE; `from` and `to` are inclusive.
 */
export interface SqlWindow {
	readonly from?: string;
	readonly to?: string;
	readonly cohort?: string;
}

/** A view as the guard puts it in place of its name. */
export interface GuardedView {
	/** The column whose range in the WHERE that reads the view is passed to `statement`. */
	readonly windowColumn?: string;
	statement(window: SqlWindow): string;
}

/** One call of a server table function: its literal arguments, unquoted. */
export interface SqlTableFunctionCall {
	readonly name: string;
	readonly args: readonly string[];
	/** Its place among the query's calls, from 0: names its parameters. */
	readonly index: number;
}

/** The statement in place of a call, or why its arguments are refused. */
export type SqlTableFunction = (
	call: SqlTableFunctionCall,
) => { sql: string } | { failure: SqlFailure };

type TokenKind = "word" | "quoted" | "string" | "number" | "symbol";

interface Token {
	readonly kind: TokenKind;
	readonly text: string;
	readonly start: number;
	readonly spaceBefore: boolean;
}

/** Prefix of the WITH subqueries the agent names; no real table has it. */
const CTE_PREFIX = "opaline_cte_";
const SCOPE_COLUMNS = new Set(["organization_id", "workspace_id"]);

/**
 * Words that take parentheses without being a function call: clauses,
 * operators and window syntax. Every other name before `(` is a function and
 * must be on the function list (`sql-functions.ts`).
 */
const PAREN_KEYWORDS = new Set([
	"AS",
	"IN",
	"OVER",
	"FILTER",
	"FROM",
	"JOIN",
	"USING",
	"ON",
	"WHERE",
	"PREWHERE",
	"HAVING",
	"QUALIFY",
	"AND",
	"OR",
	"NOT",
	"SELECT",
	"BY",
	"WHEN",
	"THEN",
	"ELSE",
	"CASE",
	"DISTINCT",
	"ALL",
	"ANY",
	"EXISTS",
	"WITH",
	"UNION",
	"EXCEPT",
	"INTERSECT",
	"LIMIT",
	"OFFSET",
	"BETWEEN",
	"LIKE",
	"ILIKE",
	"IS",
	"INTERVAL",
	"WINDOW",
	"PARTITION",
	"ROWS",
	"RANGE",
	"ARRAY",
	"GLOBAL",
	"ASC",
	"DESC",
	"ESCAPE",
]);
/** The IN family as functions: their second argument can name a table. */
const IN_FUNCTIONS = new Set([
	"in",
	"notin",
	"globalin",
	"globalnotin",
	"nullin",
	"notnullin",
	"globalnullin",
	"globalnotnullin",
]);

const SET_OPERATORS = new Set(["UNION", "EXCEPT", "INTERSECT"]);
/** Keywords after which a table expression of the FROM clause ends. */
const CLAUSE_KEYWORDS = new Set([
	"WHERE",
	"PREWHERE",
	"GROUP",
	"ORDER",
	"LIMIT",
	"HAVING",
	"UNION",
	"EXCEPT",
	"INTERSECT",
	"WINDOW",
	"QUALIFY",
	"SELECT",
]);
/** Words that end a WHERE condition. */
const ENDS_CONDITION = new Set([...CLAUSE_KEYWORDS, "SETTINGS", "FORMAT"]);
/**
 * Joins whose result for a row of the view depends on its other rows or keeps
 * rows the view lacks: reading fewer of its rows would change them.
 */
const ROW_DEPENDENT_JOINS = new Set(["RIGHT", "FULL", "PASTE", "ANY"]);
const COMPARISONS = new Set([">=", ">", "<=", "<"]);
const ARITHMETIC = new Set(["+", "-", "*", "/", "%"]);
/** Words of an INTERVAL literal. */
const INTERVAL_WORDS = new Set(
	[
		"INTERVAL",
		"SECOND",
		"MINUTE",
		"HOUR",
		"DAY",
		"WEEK",
		"MONTH",
		"QUARTER",
		"YEAR",
	].flatMap((word) => [word, `${word}S`]),
);
/** Words that can follow a table name without being its alias. */
const NOT_AN_ALIAS = new Set([
	...CLAUSE_KEYWORDS,
	"AS",
	"FINAL",
	"SAMPLE",
	"JOIN",
	"INNER",
	"LEFT",
	"RIGHT",
	"FULL",
	"CROSS",
	"OUTER",
	"ANY",
	"ALL",
	"ASOF",
	"SEMI",
	"ANTI",
	"ARRAY",
	"GLOBAL",
	"PASTE",
	"ON",
	"USING",
	"SETTINGS",
	"FORMAT",
	"INTO",
	"OFFSET",
]);
/** Words after which IN is an operator; after anything else `in(` is a function call. */
const KEYWORDS_BEFORE_EXPRESSIONS = new Set([
	"SELECT",
	"WHERE",
	"PREWHERE",
	"HAVING",
	"AND",
	"OR",
	"NOT",
	"ON",
	"BY",
	"WHEN",
	"THEN",
	"ELSE",
	"CASE",
	"IN",
	"AS",
	"DISTINCT",
	"GLOBAL",
	"WITH",
	"QUALIFY",
	"LIKE",
	"ILIKE",
	"BETWEEN",
	"IS",
	"INTERVAL",
	"RETURN",
]);

/**
 * `views` maps each view name to its statement; `reserved` holds lowercase
 * names of server databases and tables the agent's SQL may not use anywhere.
 */
export function prepareAgentSql(
	query: string,
	views: ReadonlyMap<string, GuardedView>,
	reserved: ReadonlySet<string>,
	tableFunctions: ReadonlyMap<string, SqlTableFunction> = new Map(),
): { ok: true; prepared: PreparedSql } | { ok: false; failure: SqlFailure } {
	const tokens = tokenize(query);
	if ("failure" in tokens) return { ok: false, failure: tokens.failure };
	const checked = check(query, tokens.tokens, views, reserved, tableFunctions);
	if ("failure" in checked) return { ok: false, failure: checked.failure };
	return {
		ok: true,
		prepared: {
			...emit(tokens.tokens, checked.replacements),
			ctes: checked.ctes,
			parsed: emit(tokens.tokens, new Map()),
			calls: checked.calls,
		},
	};
}

/**
 * Whether the agent's SQL carries free text of its own: a string literal, a
 * quoted name or a comment (or it does not tokenize at all). Such text may
 * be copied from a transcript, so account deletion removes a statement that
 * carries any with its result (ADR 0001 as amended).
 */
export function carriesText(query: string): boolean {
	const tokenized = tokenize(query);
	if ("failure" in tokenized) return true;
	let end = 0;
	for (const token of tokenized.tokens) {
		// Whatever lies between tokens is whitespace or a comment.
		if (query.slice(end, token.start).trim() !== "") return true;
		if (token.kind === "string" || token.kind === "quoted") return true;
		end = token.start + token.text.length;
	}
	return query.slice(end).trim() !== "";
}

/** Strips the prefix the server gives WITH subquery names. */
export function withoutCtePrefix(text: string): string {
	return text.replaceAll(CTE_PREFIX, "");
}

function check(
	query: string,
	tokens: readonly Token[],
	views: ReadonlyMap<string, GuardedView>,
	reserved: ReadonlySet<string>,
	tableFunctions: ReadonlyMap<string, SqlTableFunction>,
):
	| {
			replacements: Map<number, string>;
			ctes: ReadonlySet<string>;
			calls: SqlTableFunctionCall[];
	  }
	| { failure: SqlFailure } {
	const at = (index: number) => tokens[index];
	const upper = (index: number) => {
		const token = at(index);
		return token?.kind === "word" ? token.text.toUpperCase() : "";
	};
	const fragment = (token: Token | undefined) =>
		token ? query.slice(token.start, token.start + 60).trim() : null;
	const fail = (
		kind: SqlFailure["kind"],
		token: Token | undefined,
		message: string,
		fix: string,
	) => ({ failure: { kind, message, fragment: fragment(token), fix } });

	const first = upper(0);
	if (first !== "SELECT" && first !== "WITH" && first !== "FROM")
		return fail(
			"fatal",
			at(0),
			"Only one read-only SELECT (or WITH … SELECT) is accepted; anything that writes, changes settings or describes the server is refused.",
			"Do not retry this statement. Use schema to see the views, then SELECT from them.",
		);
	const semicolon = tokens.findIndex((token) => token.text === ";");
	if (semicolon !== -1 && semicolon !== tokens.length - 1)
		return fail(
			"fatal",
			at(semicolon + 1),
			"Only one statement is accepted per call.",
			"Do not retry; send each SELECT in its own sql call.",
		);

	// WITH subqueries the agent defines: `name AS (SELECT …` or `(WITH …`.
	const ctes = new Set<string>();
	for (let index = 0; index < tokens.length; index++) {
		const token = at(index);
		const previous = at(index - 1);
		if (
			(token?.kind === "word" || token?.kind === "quoted") &&
			(upper(index - 1) === "WITH" || previous?.text === ",") &&
			upper(index + 1) === "AS" &&
			at(index + 2)?.text === "(" &&
			["SELECT", "WITH"].includes(upper(index + 3))
		) {
			if (token.kind === "quoted")
				return fail(
					"recoverable",
					token,
					"WITH subqueries need plain names.",
					"Name it with letters, digits and underscores, without quotes.",
				);
			if (views.has(token.text.toLowerCase()))
				return fail(
					"recoverable",
					token,
					`A WITH subquery cannot be named ${token.text}, the name of a view.`,
					"Give the subquery another name.",
				);
			if (isReserved(token.text, reserved)) return outsideViews(token);
			ctes.add(token.text);
		}
	}

	const replacements = new Map<number, string>();
	const calls: SqlTableFunctionCall[] = [];
	/** Token indexes of server table function names, already checked as tables. */
	const tableCalls = new Set<number>();
	/**
	 * One frame per parenthesis depth: whether it holds a query (so FROM opens
	 * a FROM clause, not EXTRACT(… FROM …)), whether a FROM clause is open, and
	 * whether a comma there starts another table.
	 */
	interface Frame {
		query: boolean;
		from: boolean;
		commaTables: boolean;
		first: number;
	}
	const frames: Frame[] = [
		{ query: true, from: false, commaTables: false, first: 0 },
	];
	for (let index = 0; index < tokens.length; index++) {
		const token = at(index);
		if (!token) break;
		const frame = frames.at(-1) ?? frames[0];
		if (!frame) break;
		if (token.text === "(") {
			frames.push({
				query: false,
				from: false,
				commaTables: false,
				first: index + 1,
			});
			continue;
		}
		if (token.text === ")") {
			if (frames.length > 1) frames.pop();
			continue;
		}
		if (token.kind === "quoted" || token.kind === "word") {
			const name = unquote(token);
			if (SCOPE_COLUMNS.has(name.toLowerCase()))
				return fail(
					"fatal",
					token,
					`${name} is not a column you can use: the server limits every query to your workspace and the sessions you may read.`,
					"Do not retry with a workspace or organization filter; remove it.",
				);
			if (ctes.has(token.text) && token.kind === "word") {
				const next = upper(index + 1);
				if (next === "AS" && at(index + 2)?.text === "(")
					replacements.set(index, `${CTE_PREFIX}${token.text}`);
			}
			const called = at(index + 1)?.text === "(";
			// A quoted name before `(` is always a call, never the IN operator.
			if (called && token.kind === "quoted" && name.toLowerCase() === "in")
				return fail(
					"fatal",
					token,
					`${name}() can read data outside the views you may query and is refused.`,
					"Do not retry with it; read only from the views listed by schema.",
				);
			const isCall =
				called &&
				(token.kind === "quoted" ||
					!PAREN_KEYWORDS.has(token.text.toUpperCase()));
			if (
				isCall &&
				!tableCalls.has(index) &&
				tableFunctions.has(name.toLowerCase())
			)
				return fail(
					"recoverable",
					token,
					`${name}() is a table, not a function of a row.`,
					`Read it in FROM or JOIN with literal arguments, e.g. SELECT r.prompt_head, s.why FROM ${name.toLowerCase()}('flaky login test') AS s JOIN runs AS r USING (run_id).`,
				);
			if (isCall && !tableCalls.has(index) && !isAllowedFunction(name))
				return { failure: unavailableFunction(name, fragment(token)) };
			if (
				isReserved(name, reserved) &&
				!ctes.has(name) &&
				!views.has(name.toLowerCase())
			)
				return outsideViews(token);
		}
		if (token.kind === "word") {
			const word = token.text.toUpperCase();
			const called = at(index + 1)?.text === "(";
			if (word === "SETTINGS")
				return fail(
					"recoverable",
					token,
					"SETTINGS cannot be changed: the server sets the query's limits.",
					"Remove the SETTINGS clause; narrow or aggregate the query to fit the limits.",
				);
			if (word === "INTO")
				return fail(
					"recoverable",
					token,
					"INTO OUTFILE is not accepted.",
					"Remove INTO …; the result comes back as a table.",
				);
			if (word === "FORMAT" && !called)
				return fail(
					"recoverable",
					token,
					"FORMAT is not accepted.",
					"Remove the FORMAT clause; the result comes back as a table.",
				);
			if (SET_OPERATORS.has(word) || word === "SELECT" || word === "WITH")
				frame.query = true;
			if (CLAUSE_KEYWORDS.has(word)) frame.from = false;
			if (word === "FROM" && opensFromClause(index, frame)) {
				frame.query = true;
				frame.from = true;
				frame.commaTables = true;
				const table = tableAt(index + 1, "from");
				if ("failure" in table) return table;
			}
			if (word === "JOIN") {
				frame.from = true;
				// ARRAY JOIN unfolds a column of the rows already read; it reads no
				// table. `… AS array JOIN t` is a table named array, then a JOIN.
				const array =
					upper(index - 1) === "ARRAY" &&
					upper(index - 2) !== "AS" &&
					hasArrayJoinPrefix(index - 2);
				frame.commaTables = !array;
				if (!array) {
					const table = tableAt(index + 1, "from");
					if ("failure" in table) return table;
				}
			}
			// `USING a, b` lists columns; `USING (a, b)` keeps them in parentheses.
			if (word === "USING" && at(index + 1)?.text !== "(")
				frame.commaTables = false;
			if (word === "IN") {
				if (called && !isOperatorIn(index))
					return fail(
						"fatal",
						token,
						"in() as a function can read data outside the views you may query and is refused.",
						"Do not retry with in(); write value IN (SELECT … FROM a view).",
					);
				const table = tableAt(index + 1, "in");
				if ("failure" in table) return table;
			}
		}
		if (token.text === "," && frame.from && frame.commaTables) {
			const table = tableAt(index + 1, "from");
			if ("failure" in table) return table;
		}
	}
	return { replacements, ctes, calls };

	/**
	 * FROM opens a FROM clause in a query (after SELECT or WITH, or first, as
	 * in `FROM t SELECT …`); inside EXTRACT(… FROM …), trim, substring or
	 * IS [NOT] DISTINCT FROM it is part of an expression.
	 */
	function opensFromClause(index: number, frame: Frame): boolean {
		const distinct =
			upper(index - 1) === "DISTINCT" &&
			(upper(index - 2) === "IS" ||
				(upper(index - 2) === "NOT" && upper(index - 3) === "IS"));
		if (distinct) return false;
		return frame.query || index === frame.first;
	}

	/** ARRAY before JOIN is the ARRAY JOIN keyword after a table, LEFT or INNER. */
	function hasArrayJoinPrefix(index: number): boolean {
		const token = at(index);
		if (!token) return false;
		if (token.kind !== "word") return true;
		const word = token.text.toUpperCase();
		return word === "LEFT" || word === "INNER" || !NOT_AN_ALIAS.has(word);
	}

	/** IN after an expression is the operator; after a keyword or symbol, `in(` is a call. */
	function isOperatorIn(index: number): boolean {
		let before = index - 1;
		while (upper(before) === "NOT" || upper(before) === "GLOBAL") before--;
		const token = at(before);
		if (!token) return false;
		if (token.kind === "word")
			return !KEYWORDS_BEFORE_EXPRESSIONS.has(token.text.toUpperCase());
		return token.kind !== "symbol" || token.text === ")" || token.text === "]";
	}

	/**
	 * The table expression at `index` after FROM, JOIN, a comma of the FROM
	 * clause, or IN: a view (replaced by its statement), a WITH subquery
	 * (renamed), or a subquery. Anything else reads outside the views.
	 */
	function tableAt(
		index: number,
		context: "from" | "in",
	): { ok: true } | { failure: SqlFailure } {
		const token = at(index);
		if (!token) return { ok: true };
		if (token.text === "(") {
			let inner = index + 1;
			while (at(inner)?.text === "(") inner++;
			const innerToken = at(inner);
			if (context === "in") {
				// `x IN (name)` or `x IN (db.name)` could name a table: hold it to the same rule.
				if (
					(innerToken?.kind === "word" || innerToken?.kind === "quoted") &&
					(at(inner + 1)?.text === ")" || at(inner + 1)?.text === ".")
				)
					return tableAt(inner, "in");
				return { ok: true };
			}
			if (["SELECT", "WITH", "FROM"].includes(upper(inner)))
				return { ok: true };
			return outsideViews(innerToken);
		}
		if (token.kind !== "word" && token.kind !== "quoted")
			return context === "in" ? { ok: true } : outsideViews(token);
		const next = at(index + 1);
		if (next?.text === "(") {
			const tableFunction =
				token.kind === "word"
					? tableFunctions.get(token.text.toLowerCase())
					: undefined;
			if (context === "from" && tableFunction)
				return tableFunctionAt(index, tableFunction);
			// `x IN tuple(…)` is an expression; after FROM it is a table function.
			return context === "in" ? { ok: true } : outsideViews(token);
		}
		if (next?.text === ".") return outsideViews(token);
		const name = unquote(token);
		const view = views.get(name.toLowerCase());
		const alias = hasAlias(index + 1);
		if (view !== undefined) {
			const named = alias
				? unquote(
						at(upper(index + 1) === "AS" ? index + 2 : index + 1) ?? token,
					)
				: name;
			const statement = view.statement(
				context === "from" && view.windowColumn !== undefined
					? windowOf(index, named, view.windowColumn)
					: {},
			);
			replacements.set(
				index,
				context === "in" || alias
					? `(${statement})`
					: `(${statement}) AS ${name}`,
			);
			return { ok: true };
		}
		if (token.kind === "word" && ctes.has(name)) {
			replacements.set(
				index,
				context === "in" || alias
					? `${CTE_PREFIX}${name}`
					: `${CTE_PREFIX}${name} AS ${name}`,
			);
			return { ok: true };
		}
		return outsideViews(token);
	}

	/**
	 * The range of `column` that every row the query reads from the view at
	 * `index` must lie in: from conditions ANDed into the WHERE of the query
	 * whose FROM starts with the view, comparing the column (bare when the view
	 * is the only table, or under its name `named`) with constants. Nothing
	 * when that cannot be said for certain: an OR or `?:` at the top of the
	 * WHERE, a join that is not decided row by row (RIGHT, FULL, PASTE, ANY),
	 * the column's name given to something else, or a bound that reads a
	 * column.
	 */
	function windowOf(index: number, named: string, column: string): SqlWindow {
		if (upper(index - 1) !== "FROM" || renamed(column)) return {};
		let joined = false;
		let where = -1;
		for (let cursor = index + 1, depth = 0; cursor < tokens.length; cursor++) {
			const text = at(cursor)?.text;
			if (text === "(") depth++;
			else if (text === ")" && depth-- === 0) return {};
			if (depth > 0 || text === "(" || text === ")") continue;
			const word = upper(cursor);
			if (ROW_DEPENDENT_JOINS.has(word)) return {};
			if (word === "JOIN" || text === ",") joined = true;
			if (word === "WHERE") {
				where = cursor + 1;
				break;
			}
			if (ENDS_CONDITION.has(word) || text === ";") return {};
		}
		if (where === -1) return {};
		const conditions: [number, number][] = [];
		let start = where;
		let end = where;
		let between = false;
		for (let depth = 0, cases = 0; end < tokens.length; end++) {
			const text = at(end)?.text;
			const word = upper(end);
			if (text === "(") depth++;
			else if (text === ")" && depth-- === 0) break;
			if (depth > 0 || text === "(" || text === ")") continue;
			if (ENDS_CONDITION.has(word) || text === ";") break;
			if (word === "CASE") cases++;
			if (word === "END") cases--;
			if (cases > 0) continue;
			if (word === "OR" || text === "?") return {};
			if (word === "BETWEEN") between = true;
			else if (word === "AND" && between) between = false;
			else if (word === "AND") {
				conditions.push([start, end]);
				start = end + 1;
			}
		}
		conditions.push([start, end]);
		/** Whether tokens [from, to) name the view's column. */
		const reference = (from: number, to: number) => {
			const name = (index: number) => {
				const token = at(index);
				return token?.kind === "word" || token?.kind === "quoted"
					? unquote(token)
					: undefined;
			};
			if (to - from === 1) return !joined && name(from) === column;
			return (
				to - from === 3 &&
				name(from) === named &&
				at(from + 1)?.text === "." &&
				name(from + 2) === column
			);
		};
		let from: string | undefined;
		let to: string | undefined;
		for (const [first, last] of conditions) {
			const length = [1, 3].find((size) => reference(first, first + size));
			if (length !== undefined && upper(first + length) === "BETWEEN") {
				const low = first + length + 1;
				const and = tokens.findIndex(
					(token, index) =>
						index > low && index < last && token.text.toUpperCase() === "AND",
				);
				if (and !== -1 && constant(low, and) && constant(and + 1, last)) {
					from ??= sqlOf(low, and);
					to ??= sqlOf(and + 1, last);
				}
				continue;
			}
			for (let op = first + 1; op < last; op++) {
				const symbol = at(op)?.text ?? "";
				if (!COMPARISONS.has(symbol)) continue;
				// column >= bound, or bound >= column: which side is the bound.
				const lower = symbol.startsWith(">");
				if (reference(first, op) && constant(op + 1, last)) {
					if (lower) from ??= sqlOf(op + 1, last);
					else to ??= sqlOf(op + 1, last);
				} else if (reference(op + 1, last) && constant(first, op)) {
					if (lower) to ??= sqlOf(first, op);
					else from ??= sqlOf(first, op);
				}
			}
		}
		return {
			...(from === undefined ? {} : { from }),
			...(to === undefined ? {} : { to }),
		};
	}

	/** Whether the query gives `column`'s name to something else: `AS column`, or an alias without AS. */
	function renamed(column: string): boolean {
		return tokens.some((token, index) => {
			if (token.kind !== "word" && token.kind !== "quoted") return false;
			if (unquote(token) !== column) return false;
			const before = at(index - 1);
			if (!before) return false;
			if (before.kind === "word") {
				const word = before.text.toUpperCase();
				return word === "AS" || !KEYWORDS_BEFORE_EXPRESSIONS.has(word);
			}
			return (
				before.kind !== "symbol" || before.text === ")" || before.text === "]"
			);
		});
	}

	/** Whether tokens [from, to) are an expression of constants: literals, listed functions, intervals and arithmetic. */
	function constant(from: number, to: number): boolean {
		if (from >= to) return false;
		let depth = 0;
		for (let index = from; index < to; index++) {
			const token = at(index);
			if (!token) return false;
			if (token.kind === "string" || token.kind === "number") continue;
			if (token.kind === "quoted") return false;
			if (token.kind === "symbol") {
				if (token.text === "(") depth++;
				else if (token.text === ")") depth--;
				else if (
					!(ARITHMETIC.has(token.text) || (token.text === "," && depth > 0))
				)
					return false;
				if (depth < 0) return false;
				continue;
			}
			const word = token.text.toUpperCase();
			const call =
				at(index + 1)?.text === "(" &&
				!PAREN_KEYWORDS.has(word) &&
				isAllowedFunction(token.text);
			if (!call && !INTERVAL_WORDS.has(word)) return false;
		}
		return depth === 0;
	}

	function sqlOf(from: number, to: number): string {
		return tokens
			.slice(from, to)
			.map((token) => token.text)
			.join(" ");
	}

	/**
	 * A server table function at `index` (its name, then `(`): literal
	 * arguments only, replaced as a whole by the statement the server gives.
	 */
	function tableFunctionAt(
		index: number,
		tableFunction: SqlTableFunction,
	): { ok: true } | { failure: SqlFailure } {
		const token = at(index);
		const name = token?.text.toLowerCase() ?? "";
		const args: string[] = [];
		let cursor = index + 2;
		while (at(cursor)?.text !== ")") {
			const argument = at(cursor);
			const separator = at(cursor + 1);
			if (
				(argument?.kind !== "string" && argument?.kind !== "number") ||
				(separator?.text !== "," && separator?.text !== ")")
			)
				return fail(
					"recoverable",
					argument ?? token,
					`${name}() takes literal arguments only.`,
					`Write e.g. ${name}('flaky login test') or ${name}('--legacy', 'exact', 90); join it to runs for filters.`,
				);
			args.push(
				argument.kind === "string"
					? argument.text
							.slice(1, -1)
							.replaceAll("''", "'")
							.replace(/\\(.)/gu, "$1")
					: argument.text,
			);
			cursor += separator.text === "," ? 2 : 1;
		}
		const call = { name, args, index: calls.length };
		const statement = tableFunction(call);
		if ("failure" in statement) return statement;
		calls.push(call);
		tableCalls.add(index);
		for (let blank = index + 1; blank <= cursor; blank++)
			replacements.set(blank, "");
		// Unnamed calls are named after the function, numbered from the second.
		const alias = call.index === 0 ? name : `${name}_${call.index + 1}`;
		replacements.set(
			index,
			hasAlias(cursor + 1)
				? `(${statement.sql})`
				: `(${statement.sql}) AS ${alias}`,
		);
		return { ok: true };
	}

	/** Whether the agent named the table expression: `AS name`, a quoted name or a bare word. */
	function hasAlias(index: number): boolean {
		const token = at(index);
		if (!token) return false;
		if (token.kind === "quoted" || upper(index) === "AS") return true;
		return token.kind === "word" && !NOT_AN_ALIAS.has(token.text.toUpperCase());
	}

	function outsideViews(token: Token | undefined) {
		return fail(
			"fatal",
			token,
			`The query reads ${token ? `"${token.text}"` : "a table"}, which is not a view you may query. Allowed views: ${[...views.keys()].join(", ")}.`,
			"Do not retry with other tables, databases or table functions; read only from the views listed by schema.",
		);
	}
}

/** Server databases and tables, and materialized views, which read their tables. */
function isReserved(name: string, reserved: ReadonlySet<string>): boolean {
	const lower = name.toLowerCase();
	return reserved.has(lower) || lower.endsWith("_mv") || lower.startsWith(".");
}

/** A function that is not on the list: recoverable, named, with what sql offers. */
function unavailableFunction(
	name: string,
	fragment: string | null,
): SqlFailure {
	return {
		kind: "recoverable",
		message: `${name}() is not a function sql offers.`,
		fragment,
		fix: `Rewrite the query without it; ${FUNCTION_LIST_HINT}`,
	};
}

function unquote(token: Token): string {
	if (token.kind !== "quoted") return token.text;
	const quote = token.text[0] ?? "";
	return token.text
		.slice(1, -1)
		.replaceAll(`${quote}${quote}`, quote)
		.replace(/\\(.)/gu, "$1");
}

/** The statement with the replacements, keeping where each piece came from. */
function emit(
	tokens: readonly Token[],
	replacements: ReadonlyMap<number, string>,
): Pick<PreparedSql, "sql" | "originOf"> {
	let sql = "";
	const origins: { at: number; origin: number }[] = [];
	// The client appends its FORMAT clause, which a closing semicolon would cut off.
	const statement = tokens.at(-1)?.text === ";" ? tokens.slice(0, -1) : tokens;
	statement.forEach((token, index) => {
		if (index > 0 && token.spaceBefore) sql += " ";
		origins.push({ at: sql.length, origin: token.start });
		sql += replacements.get(index) ?? token.text;
	});
	return {
		sql,
		originOf(offset) {
			let origin = 0;
			for (const piece of origins) {
				if (piece.at > offset) break;
				origin = piece.origin;
			}
			return origin;
		},
	};
}

function tokenize(
	query: string,
): { tokens: Token[] } | { failure: SqlFailure } {
	const tokens: Token[] = [];
	let index = 0;
	let space = false;
	const failAt = (start: number, message: string, fix: string) => ({
		failure: {
			kind: "recoverable" as const,
			message,
			fragment: query.slice(start, start + 60).trim(),
			fix,
		},
	});
	while (index < query.length) {
		const char = query[index] ?? "";
		const rest = query.slice(index);
		if (/\s/u.test(char)) {
			space = true;
			index++;
			continue;
		}
		if (rest.startsWith("--") || char === "#") {
			const end = query.indexOf("\n", index);
			index = end === -1 ? query.length : end + 1;
			space = true;
			continue;
		}
		if (rest.startsWith("/*")) {
			let depth = 0;
			let cursor = index;
			while (cursor < query.length) {
				if (query.startsWith("/*", cursor)) {
					depth++;
					cursor += 2;
				} else if (query.startsWith("*/", cursor)) {
					depth--;
					cursor += 2;
					if (depth === 0) break;
				} else cursor++;
			}
			if (depth !== 0)
				return failAt(
					index,
					"A /* comment is not closed.",
					"Close it with */.",
				);
			index = cursor;
			space = true;
			continue;
		}
		const start = index;
		const push = (kind: TokenKind, end: number) => {
			tokens.push({
				kind,
				text: query.slice(start, end),
				start,
				spaceBefore: space,
			});
			space = false;
			index = end;
		};
		if (char === "'" || char === '"' || char === "`") {
			let cursor = index + 1;
			let closed = false;
			while (cursor < query.length) {
				const current = query[cursor];
				if (current === "\\") cursor += 2;
				else if (current === char && query[cursor + 1] === char) cursor += 2;
				else if (current === char) {
					closed = true;
					cursor++;
					break;
				} else cursor++;
			}
			if (!closed)
				return failAt(
					index,
					char === "'"
						? "A string is not closed."
						: "A quoted name is not closed.",
					`Close it with ${char}.`,
				);
			if (char !== "'" && query.slice(index, cursor).includes("\\"))
				return failAt(
					index,
					"Quoted names cannot contain escapes.",
					"Write the name without backslashes.",
				);
			push(char === "'" ? "string" : "quoted", cursor);
			continue;
		}
		const previous = tokens.at(-1);
		const afterValue =
			previous !== undefined &&
			(previous.kind === "word" ||
				previous.kind === "quoted" ||
				previous.text === ")" ||
				previous.text === "]");
		const number = rest.match(
			/^(?:0x[0-9a-f]+|0b[01]+|\d[\d_]*(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)/iu,
		);
		if (number && !(char === "." && afterValue)) {
			push("number", index + number[0].length);
			continue;
		}
		const word = rest.match(/^[\p{L}_][\p{L}\p{N}_]*/u);
		if (word) {
			push("word", index + word[0].length);
			continue;
		}
		const symbol = rest.match(
			/^(?:::|->|<=|>=|!=|<>|==|\|\||[()[\],;.+\-*/%=<>?:])/u,
		);
		if (symbol) {
			push("symbol", index + symbol[0].length);
			continue;
		}
		if (char === "{" || char === "}")
			return failAt(
				index,
				"Query parameters ({name:Type}) and braces are not accepted.",
				"Write values inline, e.g. '2026-10-01'.",
			);
		if (char === "$")
			return failAt(
				index,
				"$ is not accepted (heredoc strings).",
				"Quote text with single quotes.",
			);
		return failAt(
			index,
			`Unexpected character ${JSON.stringify(char)}.`,
			"Remove it or quote it inside a string.",
		);
	}
	return { tokens };
}

/**
 * Checks ClickHouse's own parse of the agent's SQL (`EXPLAIN AST`, one line
 * per node, indented one space per level, names decoded): every table
 * expression is a view, a WITH subquery or a subquery, no IN-family function
 * names a table, no function reads outside the views, and the workspace
 * column is not named. It catches what a gap between the token rules and
 * ClickHouse's grammar would let through.
 */
export function checkParsedSql(
	explain: readonly string[],
	tables: {
		views: ReadonlySet<string>;
		ctes: ReadonlySet<string>;
		/** Server table functions, read in FROM or JOIN with literal arguments. */
		functions?: ReadonlySet<string>;
	},
): SqlFailure | null {
	const nodes = explain.map((line) => {
		const depth = line.length - line.trimStart().length;
		const [kind = "", name = ""] = line
			.trim()
			.replace(/ \((?:children \d+|alias [^)]*)\)/gu, "")
			.split(" ");
		return { depth, kind, name };
	});
	const childrenOf = (index: number) => {
		const parent = nodes[index];
		const children: number[] = [];
		for (let next = index + 1; next < nodes.length; next++) {
			const node = nodes[next];
			if (!node || !parent || node.depth <= parent.depth) break;
			if (node.depth === parent.depth + 1) children.push(next);
		}
		return children;
	};
	const refuse = (name: string, message: string): SqlFailure => ({
		kind: "fatal",
		message,
		fragment: name || null,
		fix: "Do not retry with other tables, databases, table functions or server functions; read only from the views listed by schema.",
	});
	const allowedTable = (name: string) =>
		!name.includes(".") &&
		(tables.views.has(name.toLowerCase()) || tables.ctes.has(name));
	const outside = (name: string) =>
		refuse(
			name,
			`The query reads "${name}", which is not a view you may query. Allowed views: ${[...tables.views].join(", ")}.`,
		);
	/** Server table function nodes, whose arguments are all literals. */
	const tableFunctions = new Set<number>();
	const literalsOnly = (index: number): boolean =>
		childrenOf(index).every((child) => {
			const node = nodes[child];
			return (
				node?.kind === "Literal" ||
				(node?.kind === "ExpressionList" && literalsOnly(child))
			);
		});
	for (const [index, node] of nodes.entries()) {
		if (node.kind === "TableExpression")
			for (const child of childrenOf(index)) {
				const table = nodes[child];
				if (!table) continue;
				if (table.kind === "TableIdentifier") {
					if (!allowedTable(table.name)) return outside(table.name);
				} else if (
					table.kind === "Function" &&
					tables.functions?.has(table.name.toLowerCase()) &&
					literalsOnly(child)
				)
					tableFunctions.add(child);
				else if (table.kind !== "Subquery") return outside(table.name);
			}
		if (node.kind === "Function" && !tableFunctions.has(index)) {
			const lower = node.name.toLowerCase();
			if (!isAllowedFunction(node.name))
				return unavailableFunction(node.name, node.name);
			if (IN_FUNCTIONS.has(lower)) {
				const [list] = childrenOf(index);
				const set = list === undefined ? undefined : childrenOf(list)[1];
				const target = set === undefined ? undefined : nodes[set];
				if (target?.kind === "Identifier" && !allowedTable(target.name))
					return outside(target.name);
			}
		}
		if (
			node.kind === "Identifier" &&
			node.name.split(".").some((part) => SCOPE_COLUMNS.has(part.toLowerCase()))
		)
			return refuse(
				node.name,
				`${node.name} is not a column you can use: the server limits every query to your workspace and the sessions you may read.`,
			);
	}
	return null;
}
