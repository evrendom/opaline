import { ORPCError } from "@orpc/server";
import {
	type AnalysisFindInput,
	FIND_ARRAY_OPERATORS,
	FIND_BOOLEAN_OPERATORS,
	FIND_DATE_OPERATORS,
	FIND_NUMERIC_OPERATORS,
	FIND_STRING_OPERATORS,
	type FindFilter,
	type FindFilterOperator,
} from "@rudel/api-routes";

export type FilterKind =
	| "string"
	| "number"
	| "integer"
	| "date"
	| "boolean"
	| "array";

export interface FilterColumn {
	readonly name: string;
	readonly type: string;
}

export interface FilterView {
	readonly name: string;
	readonly columns: readonly FilterColumn[];
	readonly unsupported: readonly string[];
}

export interface CompiledFilters {
	readonly view: string;
	readonly sql: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly text: string;
}

export const FILTER_OPERATORS: Readonly<
	Record<FilterKind, readonly FindFilterOperator[]>
> = {
	string: FIND_STRING_OPERATORS,
	number: FIND_NUMERIC_OPERATORS,
	integer: FIND_NUMERIC_OPERATORS,
	date: FIND_DATE_OPERATORS,
	boolean: FIND_BOOLEAN_OPERATORS,
	array: FIND_ARRAY_OPERATORS,
};

const MULTI_VALUE: ReadonlySet<FindFilterOperator> = new Set([
	"exact",
	"is_not",
]);
const NO_VALUE: ReadonlySet<FindFilterOperator> = new Set([
	"is_set",
	"is_not_set",
]);
const CLOSEST_KEYS = 5;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

export function filterKind(type: string): FilterKind | null {
	const bare = unwrap(type);
	if (bare.startsWith("Array(")) return "array";
	if (bare === "Bool" || bare === "UInt8") return "boolean";
	if (bare.startsWith("DateTime") || bare === "Date" || bare === "Date32")
		return "date";
	if (bare.startsWith("Float") || bare.startsWith("Decimal")) return "number";
	if (/^U?Int\d+$/u.test(bare)) return "integer";
	if (
		bare === "String" ||
		bare.startsWith("FixedString(") ||
		bare.startsWith("Enum")
	)
		return "string";
	return null;
}

function unwrap(type: string): string {
	const match = /^(?:LowCardinality|Nullable)\((.*)\)$/u.exec(type);
	return match?.[1] ? unwrap(match[1]) : type;
}

export function compileFilters(
	filters: readonly FindFilter[],
	view: FilterView,
	source: AnalysisFindInput["source"],
	prefix = "filter",
): CompiledFilters {
	const conditions: string[] = [];
	const params: Record<string, unknown> = {};
	filters.forEach((filter, index) => {
		const column = view.columns.find(
			(candidate) => candidate.name === filter.key,
		);
		if (!column) throw unknownKey(filter.key, index, view, source);
		const kind = filterKind(column.type);
		if (!kind)
			throw filterError(
				index,
				`${filter.key} is ${column.type}, which find cannot filter; read it with sql`,
			);
		const allowed = FILTER_OPERATORS[kind];
		if (!allowed.includes(filter.operator))
			throw filterError(
				index,
				`operator ${filter.operator} does not apply to ${filter.key} (${kind}, ${column.type}); use one of: ${allowed.join(", ")}`,
			);
		const name = `${prefix}${index}`;
		const values = filterValues(filter, index);
		conditions.push(
			condition(
				kind,
				filter.operator,
				column.name,
				name,
				values,
				params,
				index,
			),
		);
	});
	return {
		view: view.name,
		sql: conditions.map((part) => `(${part})`).join(" AND "),
		params,
		text: filters.map(describeFilter).join(" AND "),
	};
}

export function describeFilter(filter: FindFilter): string {
	return NO_VALUE.has(filter.operator)
		? `${filter.key} ${filter.operator}`
		: `${filter.key} ${filter.operator} ${JSON.stringify(filter.value)}`;
}

function filterValues(
	filter: FindFilter,
	index: number,
): readonly (string | number | boolean)[] {
	if (NO_VALUE.has(filter.operator)) {
		if (filter.value !== undefined)
			throw filterError(index, `${filter.operator} takes no value`);
		return [];
	}
	if (filter.value === undefined)
		throw filterError(index, `${filter.operator} needs a value`);
	if (Array.isArray(filter.value)) {
		if (!MULTI_VALUE.has(filter.operator))
			throw filterError(
				index,
				`${filter.operator} takes one value; only exact and is_not take an array`,
			);
		return filter.value;
	}
	return [filter.value];
}

function condition(
	kind: FilterKind,
	operator: FindFilterOperator,
	column: string,
	name: string,
	values: readonly (string | number | boolean)[],
	params: Record<string, unknown>,
	index: number,
): string {
	const one = values[0];
	if (kind === "string") {
		if (operator === "is_set") return `ifNull(${column}, '') != ''`;
		if (operator === "is_not_set") return `ifNull(${column}, '') = ''`;
		if (operator === "exact" || operator === "is_not") {
			params[name] = values.map(String);
			return operator === "exact"
				? `ifNull(${column} IN {${name}:Array(String)}, 0)`
				: `ifNull(${column} NOT IN {${name}:Array(String)}, 1)`;
		}
		params[name] = String(one);
		if (operator === "icontains")
			return `ifNull(positionCaseInsensitiveUTF8(${column}, {${name}:String}) > 0, 0)`;
		if (operator === "not_icontains")
			return `ifNull(positionCaseInsensitiveUTF8(${column}, {${name}:String}) = 0, 1)`;
		if (operator === "regex")
			return `ifNull(match(${column}, {${name}:String}), 0)`;
		return `ifNull(NOT match(${column}, {${name}:String}), 1)`;
	}
	if (kind === "number" || kind === "integer") {
		if (operator === "is_set") return `${column} IS NOT NULL`;
		if (operator === "is_not_set") return `${column} IS NULL`;
		if (operator === "exact" && kind === "integer") {
			params[name] = values.map((value) => integerValue(value, index));
			return `ifNull(has({${name}:Array(String)}, toString(${column})), 0)`;
		}
		if (operator === "exact") {
			params[name] = values.map((value) => numberValue(value, index));
			return `ifNull(has({${name}:Array(Float64)}, toFloat64(${column})), 0)`;
		}
		params[name] = numberValue(one, index);
		return `ifNull(${column} ${operator === "gt" ? ">" : "<"} {${name}:Float64}, 0)`;
	}
	if (kind === "boolean") {
		params[name] = values.map((value) => booleanValue(value, index));
		return `ifNull(toUInt8(${column}) IN {${name}:Array(UInt8)}, 0)`;
	}
	if (kind === "date") {
		if (operator === "is_date_exact") {
			params[name] = dayValue(one, index);
			return `ifNull(toDate(${column}) = {${name}:Date}, 0)`;
		}
		params[name] = dateValue(one, index);
		return `ifNull(${column} ${operator === "is_date_before" ? "<" : ">"} parseDateTime64BestEffort({${name}:String}, 3, 'UTC'), 0)`;
	}
	if (operator === "is_set") return `notEmpty(${column})`;
	if (operator === "is_not_set") return `empty(${column})`;
	params[name] = String(one);
	const any = `arrayExists(element -> positionCaseInsensitiveUTF8(toString(element), {${name}:String}) > 0, ${column})`;
	return operator === "icontains" ? any : `NOT ${any}`;
}

function integerValue(value: string | number | boolean, index: number): string {
	const text = String(value).trim();
	if (typeof value === "boolean" || !/^-?\d{1,20}$/u.test(text))
		throw filterError(index, `${JSON.stringify(value)} is not an integer`);
	return BigInt(text).toString();
}

function numberValue(value: unknown, index: number): number {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: Number.NaN;
	if (!Number.isFinite(parsed))
		throw filterError(index, `${JSON.stringify(value)} is not a number`);
	return parsed;
}

function booleanValue(value: string | number | boolean, index: number): number {
	if (value === true || value === 1 || value === "true" || value === "1")
		return 1;
	if (value === false || value === 0 || value === "false" || value === "0")
		return 0;
	throw filterError(index, `${JSON.stringify(value)} is not true or false`);
}

function dayValue(value: unknown, index: number): string {
	if (typeof value !== "string" || !DAY.test(value) || !isDate(value))
		throw filterError(
			index,
			`is_date_exact takes a day as YYYY-MM-DD (UTC), not ${JSON.stringify(value)}`,
		);
	return value;
}

function dateValue(value: unknown, index: number): string {
	if (typeof value !== "string" || !isDate(value))
		throw filterError(
			index,
			`${JSON.stringify(value)} is not a date: pass YYYY-MM-DD or an ISO 8601 time (UTC)`,
		);
	return value;
}

function isDate(value: string): boolean {
	return Number.isFinite(
		Date.parse(DAY.test(value) ? `${value}T00:00:00Z` : value),
	);
}

function unknownKey(
	key: string,
	index: number,
	view: FilterView,
	source: AnalysisFindInput["source"],
): ORPCError<"BAD_REQUEST", unknown> {
	if (view.unsupported.includes(key))
		return filterError(
			index,
			`${key} is a column of the ${view.name} view that find source=${source} cannot filter on; read it with sql`,
		);
	const names = view.columns.map((column) => column.name);
	return filterError(
		index,
		`${JSON.stringify(key)} is not a column of the ${view.name} view, which source=${source} filters. Closest: ${closestKeys(key, names).join(", ")}. Valid keys: ${names.join(", ")}. DO NOT GUESS a key or its values: you MUST run schema view=${view.name} column=<key> to see a column's type and top values before filtering on it (where schema is not among your tools, copy a value from an earlier find result).`,
	);
}

export function closestKeys(key: string, names: readonly string[]): string[] {
	const wanted = key.toLowerCase();
	return names
		.map((name) => {
			const lower = name.toLowerCase();
			const contains = lower.includes(wanted) || wanted.includes(lower);
			return { name, score: distance(wanted, lower) - (contains ? 100 : 0) };
		})
		.sort(
			(left, right) =>
				left.score - right.score || left.name.localeCompare(right.name),
		)
		.slice(0, CLOSEST_KEYS)
		.map(({ name }) => name);
}

function distance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		const current = [i];
		for (let j = 1; j <= right.length; j++)
			current[j] = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1),
			);
		previous = current;
	}
	return previous[right.length] ?? 0;
}

export function filterError(
	index: number,
	message: string,
): ORPCError<"BAD_REQUEST", unknown> {
	return new ORPCError("BAD_REQUEST", {
		message: `filters[${index}]: ${message}`,
	});
}

export function isRegexError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/CANNOT_COMPILE_REGEXP|cannot compile re2|OptimizedRegularExpression/iu.test(
			error.message,
		)
	);
}
