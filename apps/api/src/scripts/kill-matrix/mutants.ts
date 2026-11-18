import ts from "typescript";

/**
 * Mutants of one TypeScript module: each is a single text edit that changes
 * what the code does (a swapped operator, a negated condition, a changed
 * literal, a removed statement or return value). Types, imports and property
 * names are never mutated, so every mutant is a runtime change.
 */

export type MutationOperator =
	| "arithmetic"
	| "equality"
	| "comparison"
	| "logical"
	| "boolean"
	| "conditional"
	| "literal"
	| "update"
	| "statement"
	| "return";

export interface Mutant {
	readonly id: number;
	readonly operator: MutationOperator;
	/** Source offsets of the replaced text. */
	readonly start: number;
	readonly end: number;
	readonly original: string;
	readonly replacement: string;
	/** 1-based position of `start`. */
	readonly line: number;
	readonly column: number;
}

interface Swap {
	readonly operator: MutationOperator;
	readonly replacements: readonly string[];
}

const BINARY_SWAPS: ReadonlyMap<ts.SyntaxKind, Swap> = new Map([
	[ts.SyntaxKind.PlusToken, { operator: "arithmetic", replacements: ["-"] }],
	[ts.SyntaxKind.MinusToken, { operator: "arithmetic", replacements: ["+"] }],
	[
		ts.SyntaxKind.AsteriskToken,
		{ operator: "arithmetic", replacements: ["/"] },
	],
	[ts.SyntaxKind.SlashToken, { operator: "arithmetic", replacements: ["*"] }],
	[ts.SyntaxKind.PercentToken, { operator: "arithmetic", replacements: ["*"] }],
	[
		ts.SyntaxKind.EqualsEqualsEqualsToken,
		{ operator: "equality", replacements: ["!=="] },
	],
	[
		ts.SyntaxKind.ExclamationEqualsEqualsToken,
		{ operator: "equality", replacements: ["==="] },
	],
	[
		ts.SyntaxKind.EqualsEqualsToken,
		{ operator: "equality", replacements: ["!="] },
	],
	[
		ts.SyntaxKind.ExclamationEqualsToken,
		{ operator: "equality", replacements: ["=="] },
	],
	[
		ts.SyntaxKind.LessThanToken,
		{ operator: "comparison", replacements: ["<=", ">="] },
	],
	[
		ts.SyntaxKind.LessThanEqualsToken,
		{ operator: "comparison", replacements: ["<", ">"] },
	],
	[
		ts.SyntaxKind.GreaterThanToken,
		{ operator: "comparison", replacements: [">=", "<="] },
	],
	[
		ts.SyntaxKind.GreaterThanEqualsToken,
		{ operator: "comparison", replacements: [">", "<"] },
	],
	[
		ts.SyntaxKind.AmpersandAmpersandToken,
		{ operator: "logical", replacements: ["||"] },
	],
	[ts.SyntaxKind.BarBarToken, { operator: "logical", replacements: ["&&"] }],
	[
		ts.SyntaxKind.QuestionQuestionToken,
		{ operator: "logical", replacements: ["&&"] },
	],
	[ts.SyntaxKind.PlusEqualsToken, { operator: "update", replacements: ["-="] }],
	[
		ts.SyntaxKind.MinusEqualsToken,
		{ operator: "update", replacements: ["+="] },
	],
]);

/** Declarations that only exist for the type checker or the module graph. */
const SKIPPED_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
	ts.SyntaxKind.ImportDeclaration,
	ts.SyntaxKind.ImportEqualsDeclaration,
	ts.SyntaxKind.ExportDeclaration,
	ts.SyntaxKind.InterfaceDeclaration,
	ts.SyntaxKind.TypeAliasDeclaration,
]);

/** Every mutant of `source`, in source order, numbered from 1. */
export function generateMutants(fileName: string, source: string): Mutant[] {
	const file = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const edits: Omit<Mutant, "id" | "line" | "column">[] = [];
	const add = (
		operator: MutationOperator,
		node: ts.Node,
		replacement: string,
	) => {
		const start = node.getStart(file);
		edits.push({
			operator,
			start,
			end: node.getEnd(),
			original: source.slice(start, node.getEnd()),
			replacement,
		});
	};

	const visit = (node: ts.Node): void => {
		if (SKIPPED_KINDS.has(node.kind) || ts.isTypeNode(node)) return;
		if (ts.isBinaryExpression(node)) {
			const swap = BINARY_SWAPS.get(node.operatorToken.kind);
			if (swap)
				for (const replacement of swap.replacements)
					add(swap.operator, node.operatorToken, replacement);
		} else if (ts.isPrefixUnaryExpression(node)) {
			if (node.operator === ts.SyntaxKind.ExclamationToken)
				add("boolean", node, node.operand.getText(file));
			else if (node.operator === ts.SyntaxKind.MinusToken)
				add("arithmetic", node, `+${node.operand.getText(file)}`);
			else if (node.operator === ts.SyntaxKind.PlusPlusToken)
				add("update", node, `--${node.operand.getText(file)}`);
			else if (node.operator === ts.SyntaxKind.MinusMinusToken)
				add("update", node, `++${node.operand.getText(file)}`);
		} else if (ts.isPostfixUnaryExpression(node)) {
			add(
				"update",
				node,
				`${node.operand.getText(file)}${node.operator === ts.SyntaxKind.PlusPlusToken ? "--" : "++"}`,
			);
		} else if (node.kind === ts.SyntaxKind.TrueKeyword) {
			add("boolean", node, "false");
		} else if (node.kind === ts.SyntaxKind.FalseKeyword) {
			add("boolean", node, "true");
		} else if (ts.isNumericLiteral(node) && !isPropertyName(node)) {
			add("literal", node, `${Number(node.text) + 1}`);
		} else if (
			// A tag (`sql`, `html`) gives its template its own language; only
			// the substituted expressions are mutated.
			(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
			!isPropertyName(node) &&
			!ts.isExpressionStatement(node.parent) &&
			!ts.isTaggedTemplateExpression(node.parent)
		) {
			add("literal", node, node.text === "" ? '"mutated"' : '""');
		} else if (
			ts.isTemplateExpression(node) &&
			!ts.isTaggedTemplateExpression(node.parent)
		) {
			add("literal", node, '""');
		} else if (
			(ts.isExpressionStatement(node) &&
				!ts.isStringLiteral(node.expression)) ||
			ts.isThrowStatement(node)
		) {
			add("statement", node, ";");
		} else if (
			ts.isReturnStatement(node) &&
			node.expression &&
			!isUndefined(node.expression)
		) {
			add("return", node, "return undefined;");
		}

		const condition = conditionOf(node);
		if (condition && !negatedByOperator(condition))
			add("conditional", condition, `!(${condition.getText(file)})`);
		if (
			ts.isArrowFunction(node) &&
			!ts.isBlock(node.body) &&
			!isUndefined(node.body)
		)
			add("return", node.body, "undefined");

		ts.forEachChild(node, visit);
	};
	visit(file);

	return edits
		.sort((left, right) => left.start - right.start || left.end - right.end)
		.map((edit, index) => {
			const { line, character } = file.getLineAndCharacterOfPosition(
				edit.start,
			);
			return { ...edit, id: index + 1, line: line + 1, column: character + 1 };
		});
}

export function applyMutant(source: string, mutant: Mutant): string {
	return (
		source.slice(0, mutant.start) +
		mutant.replacement +
		source.slice(mutant.end)
	);
}

/** `undefined` or `void 0`: returning it instead changes nothing. */
function isUndefined(node: ts.Expression): boolean {
	return (
		(ts.isIdentifier(node) && node.text === "undefined") ||
		ts.isVoidExpression(node)
	);
}

/**
 * `!x`, `a === b`, `a < b`: the operator mutants above already negate these
 * conditions, so `!(condition)` would only repeat one of them.
 */
function negatedByOperator(condition: ts.Expression): boolean {
	if (ts.isPrefixUnaryExpression(condition))
		return condition.operator === ts.SyntaxKind.ExclamationToken;
	if (!ts.isBinaryExpression(condition)) return false;
	const swap = BINARY_SWAPS.get(condition.operatorToken.kind);
	return swap?.operator === "equality" || swap?.operator === "comparison";
}

function conditionOf(node: ts.Node): ts.Expression | undefined {
	if (
		ts.isIfStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node)
	)
		return node.expression;
	if (ts.isForStatement(node)) return node.condition;
	if (ts.isConditionalExpression(node)) return node.condition;
	return undefined;
}

/** `"key"` in `{ "key": value }`: keys name the shape of the data, they compute nothing. */
function isPropertyName(node: ts.Node): boolean {
	const parent = node.parent;
	return (
		(ts.isPropertyAssignment(parent) ||
			ts.isPropertyDeclaration(parent) ||
			ts.isMethodDeclaration(parent) ||
			ts.isGetAccessorDeclaration(parent) ||
			ts.isSetAccessorDeclaration(parent) ||
			ts.isEnumMember(parent)) &&
		parent.name === node
	);
}
