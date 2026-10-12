import { basename } from "node:path";
import type { Mutant } from "./mutants.js";

/**
 * What a kill matrix says about a test suite: which tests kill which mutants,
 * which mutants no test kills, and which tests kill nothing another test does
 * not kill too. A test earns its place by killing a mutant no other test
 * kills; the rest can go.
 */

/** One run of one test against one mutant. A timeout counts as a kill. */
export type RunOutcome = "killed" | "survived" | "timeout";

/** A mutant of one of the modules under test. */
export interface MatrixMutant extends Mutant {
	readonly module: string;
}

export interface KillMatrix {
	readonly modules: readonly string[];
	readonly tests: readonly string[];
	readonly mutants: readonly MatrixMutant[];
	/** `outcomes[mutant][test]`, in the order of `mutants` and `tests`. */
	readonly outcomes: readonly (readonly RunOutcome[])[];
	/** Mutants that do not parse, so never ran. */
	readonly invalid: number;
}

export interface KillMatrixSummary {
	/** Per mutant, the indexes of the tests that kill it. */
	readonly killers: readonly (readonly number[])[];
	/** Per test, how many mutants it kills, and how many only it kills. */
	readonly kills: readonly number[];
	readonly uniqueKills: readonly number[];
	/** Tests that kill no mutant another test does not also kill. */
	readonly withoutUniqueKills: readonly number[];
	/**
	 * Tests that can all be removed together: the tests left still kill every
	 * mutant the whole suite kills. Two tests that only kill the same mutant
	 * both lack a unique kill, but only one of them is removable.
	 */
	readonly removable: readonly number[];
}

export function summarizeKillMatrix(matrix: KillMatrix): KillMatrixSummary {
	const killers = matrix.outcomes.map((row) =>
		row.flatMap((outcome, test) => (outcome === "survived" ? [] : [test])),
	);
	const testIndexes = matrix.tests.map((_, test) => test);
	const kills = testIndexes.map(() => 0);
	for (const tests of killers)
		for (const test of tests) kills[test] = (kills[test] ?? 0) + 1;
	const uniqueKillsAmong = (kept: ReadonlySet<number>) => {
		const unique = testIndexes.map(() => 0);
		for (const tests of killers) {
			const [only, ...others] = tests.filter((test) => kept.has(test));
			if (only !== undefined && others.length === 0)
				unique[only] = (unique[only] ?? 0) + 1;
		}
		return unique;
	};
	const uniqueKills = uniqueKillsAmong(new Set(testIndexes));

	// Drop the weakest redundant test, recount, repeat: removing one test can
	// make another the only killer of a mutant.
	const kept = new Set(testIndexes);
	for (;;) {
		const unique = uniqueKillsAmong(kept);
		const weakest = [...kept]
			.filter((test) => unique[test] === 0)
			.sort((left, right) => (kills[left] ?? 0) - (kills[right] ?? 0))[0];
		if (weakest === undefined) break;
		kept.delete(weakest);
	}

	return {
		killers,
		kills,
		uniqueKills,
		withoutUniqueKills: testIndexes.filter((test) => uniqueKills[test] === 0),
		removable: testIndexes.filter((test) => !kept.has(test)),
	};
}

export function formatKillMatrix(
	matrix: KillMatrix,
	summary: KillMatrixSummary,
): string {
	const label = (test: number) => `T${test + 1}`;
	const killed = summary.killers.filter((tests) => tests.length > 0).length;
	// Killed only by running out of time.
	const timeouts = matrix.outcomes.filter(
		(row) => row.includes("timeout") && !row.includes("killed"),
	).length;
	const total = matrix.mutants.length;
	const score = total === 0 ? 0 : (killed / total) * 100;
	const describe = (mutant: MatrixMutant) =>
		describeMutant(mutant, matrix.modules.length > 1);
	const width = Math.max(
		...matrix.mutants.map((mutant) => describe(mutant).length),
		0,
	);
	const cell = (outcome: RunOutcome | undefined) =>
		outcome === "killed" ? "x" : outcome === "timeout" ? "t" : ".";
	const listTests = (tests: readonly number[]) =>
		tests.length === 0
			? ["  (none)"]
			: tests.map(
					(test) =>
						`  ${label(test)}  ${matrix.tests[test]}  (kills ${summary.kills[test]})`,
				);

	return [
		`Kill matrix for ${matrix.modules.join(", ")}`,
		"",
		"Tests:",
		...matrix.tests.map((name, test) => `  ${label(test)}  ${name}`),
		"",
		`Mutants: ${total} run, ${killed} killed (${timeouts} by timeout), ${total - killed} survived, score ${score.toFixed(1)}%; ${matrix.invalid} did not parse and were skipped`,
		"",
		`${"".padEnd(width)}  ${matrix.tests.map((_, test) => label(test).padEnd(4)).join("")}`,
		...matrix.mutants.map(
			(mutant, index) =>
				`${describe(mutant).padEnd(width)}  ${matrix.tests
					.map((_, test) => cell(matrix.outcomes[index]?.[test]).padEnd(4))
					.join("")}`,
		),
		"  x killed, t killed by timeout, . survived",
		"",
		"Kills per test (unique = killed by no other test):",
		...matrix.tests.map(
			(name, test) =>
				`  ${label(test)}  ${summary.kills[test]} killed, ${summary.uniqueKills[test]} unique  ${name}`,
		),
		"",
		"Tests that kill no unique mutant:",
		...listTests(summary.withoutUniqueKills),
		"",
		"Removable together (the tests left still kill every killed mutant):",
		...listTests(summary.removable),
		"",
		"Survived mutants (no test kills them):",
		...(killed === total
			? ["  (none)"]
			: matrix.mutants
					.filter((_, index) => summary.killers[index]?.length === 0)
					.map((mutant) => `  ${describe(mutant)}`)),
	].join("\n");
}

function describeMutant(mutant: MatrixMutant, withModule: boolean): string {
	const where = `${withModule ? `${basename(mutant.module)}:` : "L"}${mutant.line}:${mutant.column}`;
	return `M${mutant.id} ${where} ${mutant.operator} ${compact(mutant.original)} -> ${compact(mutant.replacement)}`;
}

function compact(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}
