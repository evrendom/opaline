import ts from "typescript";
import { escapeRegExp } from "./escape-regexp.js";

/**
 * The tests of a `bun:test` file, read from its source so each one can run
 * alone: `bun test <file> --test-name-pattern <pattern>` runs exactly the test
 * whose full name (describe names and test name joined by spaces) matches.
 */

export interface TestCase {
	/** Full name as Bun reports it: `describe test`. */
	readonly name: string;
	readonly line: number;
	/** Anchored `--test-name-pattern` matching this test and no other. */
	readonly pattern: string;
}

const TEST_FUNCTIONS = new Set(["test", "it"]);
/** Modifiers that still run the test (`test.only`, `test.failing`, …). */
const RUNNING_MODIFIERS = new Set(["only", "serial", "concurrent", "failing"]);
/** Modifiers whose tests never run, so they cannot kill a mutant. */
const SKIPPED_MODIFIERS = new Set(["skip", "todo"]);

/**
 * Every test `source` declares with a static name. A test whose name or
 * existence is decided at run time (`test.each`, `test.if`, a computed name)
 * cannot be attributed and is an error, as is a name used twice.
 */
export function findTests(fileName: string, source: string): TestCase[] {
	const file = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
	);
	const tests: TestCase[] = [];
	const where = (node: ts.Node) =>
		`${fileName}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;

	const visit = (node: ts.Node, prefix: string): void => {
		const call = ts.isCallExpression(node) ? testCall(node) : undefined;
		if (!ts.isCallExpression(node) || !call) {
			ts.forEachChild(node, (child) => visit(child, prefix));
			return;
		}
		if (call.modifier !== undefined && SKIPPED_MODIFIERS.has(call.modifier))
			return;
		if (call.modifier !== undefined && !RUNNING_MODIFIERS.has(call.modifier))
			throw new Error(
				`${where(node)}: ${call.kind}.${call.modifier} decides its tests at run time; give each test a static name to attribute it`,
			);
		const [nameArgument, body] = node.arguments;
		if (
			!nameArgument ||
			!(
				ts.isStringLiteral(nameArgument) ||
				ts.isNoSubstitutionTemplateLiteral(nameArgument)
			)
		)
			throw new Error(
				`${where(node)}: ${call.kind} name is computed at run time; use a string literal to attribute it`,
			);
		const name = prefix ? `${prefix} ${nameArgument.text}` : nameArgument.text;
		if (call.kind === "describe") {
			if (body) visit(body, name);
			return;
		}
		if (tests.some((test) => test.name === name))
			throw new Error(
				`${where(node)}: a second test is named "${name}"; rename one so each can run alone`,
			);
		tests.push({
			name,
			line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
			pattern: `^${escapeRegExp(name)}$`,
		});
	};
	visit(file, "");
	return tests;
}

function testCall(
	node: ts.CallExpression,
): { kind: string; modifier: string | undefined } | undefined {
	const callee = node.expression;
	if (ts.isIdentifier(callee))
		return isTestFunction(callee.text)
			? { kind: callee.text, modifier: undefined }
			: undefined;
	if (
		ts.isPropertyAccessExpression(callee) &&
		ts.isIdentifier(callee.expression) &&
		isTestFunction(callee.expression.text)
	)
		return { kind: callee.expression.text, modifier: callee.name.text };
	// `test.each(table)(name, fn)` and `test.if(condition)(name, fn)`.
	if (ts.isCallExpression(callee)) {
		const inner = testCall(callee);
		if (inner) return { kind: inner.kind, modifier: inner.modifier ?? "" };
	}
	return undefined;
}

function isTestFunction(name: string): boolean {
	return TEST_FUNCTIONS.has(name) || name === "describe";
}
