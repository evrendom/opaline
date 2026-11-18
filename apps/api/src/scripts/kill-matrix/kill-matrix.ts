import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parsePositiveIntegerFlag } from "../l1-script-args.js";
import {
	formatKillMatrix,
	type KillMatrix,
	type MatrixMutant,
	type RunOutcome,
	summarizeKillMatrix,
} from "./matrix.js";
import { applyMutant, generateMutants } from "./mutants.js";
import { findTests } from "./test-names.js";

// Mutation-testing kill matrix: every mutant of the given modules runs against
// every test that imports its module, one test per `bun test` process, so the
// matrix knows exactly which tests kill which mutant. Mutants reach the tests
// through a preload hook; the modules on disk are never written.
//
//   bun run test:kill-matrix <module.ts>... [--test <file.test.ts>]...
//     [--jobs <n>] [--timeout-ms <n>] [--json <out.json>] [-- <bun test args>]

const USAGE =
	"Usage: bun run test:kill-matrix <module.ts>... [--test <file.test.ts>]... [--jobs <n>] [--timeout-ms <n>] [--json <out.json>] [-- <bun test args>]";
const PRELOAD = join(import.meta.dir, "preload.ts");

interface TestRun {
	readonly file: string;
	readonly cwd: string;
	readonly name: string;
	readonly pattern: string;
}

interface RunResult {
	readonly passed: boolean;
	readonly timedOut: boolean;
	readonly milliseconds: number;
	readonly output: string;
	/** Real paths of the modules under test the run imported. */
	readonly loaded: ReadonlySet<string>;
}

const argv = Bun.argv.slice(2);
const separator = argv.indexOf("--");
const { values, positionals } = parseArgs({
	args: separator === -1 ? argv : argv.slice(0, separator),
	allowPositionals: true,
	options: {
		test: { type: "string", multiple: true },
		jobs: { type: "string" },
		"timeout-ms": { type: "string" },
		json: { type: "string" },
	},
});
const bunTestArgs = separator === -1 ? [] : argv.slice(separator + 1);
if (positionals.length === 0) throw new Error(USAGE);
const jobs = parsePositiveIntegerFlag(
	values.jobs,
	Math.max(1, Math.floor(availableParallelism() / 2)),
	"--jobs",
);

const modules = positionals.map((path) => {
	const file = realpathSync(resolve(path));
	return { file, name: relative(process.cwd(), file) };
});
// By default each module's sibling `<name>.test.<ext>`.
const testFiles = [
	...new Set(
		(
			values.test ??
			modules.map(({ file }) => file.replace(/\.([cm]?[jt]sx?)$/, ".test.$1"))
		).map((path) => {
			if (!existsSync(path))
				throw new Error(`${path} does not exist; name the tests with --test`);
			return realpathSync(resolve(path));
		}),
	),
];

const sources = new Map(
	modules.map(({ file }) => [file, readFileSync(file, "utf8")]),
);
let invalid = 0;
const mutants: MatrixMutant[] = modules
	.flatMap(({ file, name }) => {
		const source = sources.get(file) ?? "";
		return generateMutants(name, source)
			.filter((mutant) => {
				const valid = parses(file, applyMutant(source, mutant));
				if (!valid) invalid += 1;
				return valid;
			})
			.map((mutant) => ({ ...mutant, module: file }));
	})
	.map((mutant, index) => ({ ...mutant, id: index + 1 }));
const tests: TestRun[] = testFiles.flatMap((file) =>
	findTests(relative(process.cwd(), file), readFileSync(file, "utf8")).map(
		(test) => ({
			file,
			cwd: packageDirectory(file),
			name: test.name,
			pattern: test.pattern,
		}),
	),
);

const workDirectory = mkdtempSync(join(tmpdir(), "kill-matrix-"));
const running = new Set<Bun.Subprocess>();
const cleanUp = () => {
	for (const child of running) child.kill("SIGKILL");
	rmSync(workDirectory, { recursive: true, force: true });
};
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		cleanUp();
		process.exit(signal === "SIGINT" ? 130 : 143);
	});

try {
	console.error(
		`kill-matrix: ${mutants.length} mutants (${invalid} do not parse), ${tests.length} tests, ${jobs} jobs`,
	);
	// Baseline: each test must pass alone and run exactly once, and every
	// module must be imported by some test, through the hook.
	const baseline = await inPool(
		tests.map(
			(test, index) => () =>
				runTest(test, undefined, `baseline-${index}`, 600_000),
		),
	);
	for (const [index, result] of baseline.entries()) {
		const test = tests[index];
		if (test && (!result.passed || !/\bRan 1 test\b/.test(result.output)))
			throw new Error(
				`"${test.name}" must pass when run alone before mutants run against it:\n${result.output}`,
			);
	}
	for (const { file, name } of modules)
		if (!baseline.some((result) => result.loaded.has(file)))
			throw new Error(
				`no test imports ${name}, so none can kill its mutants; name its tests with --test`,
			);
	const timeoutMs = parsePositiveIntegerFlag(
		values["timeout-ms"],
		Math.max(
			5_000,
			Math.ceil(5 * Math.max(...baseline.map((result) => result.milliseconds))),
		),
		"--timeout-ms",
	);

	for (const mutant of mutants)
		writeFileSync(
			join(workDirectory, `mutant-${mutant.id}`),
			applyMutant(sources.get(mutant.module) ?? "", mutant),
		);
	const total = mutants.length * tests.length;
	let done = 0;
	const outcomes = await inPool(
		mutants.flatMap((mutant) =>
			tests.map((test, index) => async (): Promise<RunOutcome> => {
				// A test that never imports the module cannot kill its mutants.
				const result = baseline[index]?.loaded.has(mutant.module)
					? await runTest(
							test,
							mutant,
							`mutant-${mutant.id}-${index}`,
							timeoutMs,
						)
					: undefined;
				done += 1;
				if (done % 100 === 0)
					console.error(`kill-matrix: ${done}/${total} runs`);
				if (!result || result.passed) return "survived";
				return result.timedOut ? "timeout" : "killed";
			}),
		),
	);
	const matrix: KillMatrix = {
		modules: modules.map(({ name }) => name),
		tests: tests.map((test) =>
			testFiles.length > 1
				? `${relative(process.cwd(), test.file)} > ${test.name}`
				: test.name,
		),
		mutants: mutants.map((mutant) => ({
			...mutant,
			module: relative(process.cwd(), mutant.module),
		})),
		outcomes: mutants.map((_, row) =>
			outcomes.slice(row * tests.length, (row + 1) * tests.length),
		),
		invalid,
	};
	const summary = summarizeKillMatrix(matrix);
	console.log(formatKillMatrix(matrix, summary));
	if (values.json)
		writeFileSync(
			values.json,
			`${JSON.stringify({ ...matrix, summary, timeoutMs }, null, 2)}\n`,
		);
} finally {
	cleanUp();
}

async function runTest(
	test: TestRun,
	mutant: MatrixMutant | undefined,
	run: string,
	timeoutMs: number,
): Promise<RunResult> {
	const loadedFile = join(workDirectory, `${run}.loaded`);
	const started = performance.now();
	const child = Bun.spawn(
		[
			process.execPath,
			"test",
			test.file,
			"--preload",
			PRELOAD,
			"--test-name-pattern",
			test.pattern,
			...bunTestArgs,
		],
		{
			cwd: test.cwd,
			env: {
				...process.env,
				KILL_MATRIX_MODULES: modules.map(({ file }) => file).join("\n"),
				KILL_MATRIX_LOADED: loadedFile,
				KILL_MATRIX_TARGET: mutant?.module,
				KILL_MATRIX_SOURCE: mutant
					? join(workDirectory, `mutant-${mutant.id}`)
					: undefined,
			},
			stdout: "pipe",
			stderr: "pipe",
			timeout: timeoutMs,
			killSignal: "SIGKILL",
		},
	);
	running.add(child);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	running.delete(child);
	const milliseconds = performance.now() - started;
	return {
		passed: exitCode === 0,
		timedOut: child.signalCode !== null && milliseconds >= timeoutMs,
		milliseconds,
		output: `${stdout}${stderr}`,
		loaded: new Set(
			existsSync(loadedFile)
				? readFileSync(loadedFile, "utf8").split("\n").filter(Boolean)
				: [],
		),
	};
}

async function inPool<TResult>(
	tasks: readonly (() => Promise<TResult>)[],
): Promise<TResult[]> {
	const results: TResult[] = [];
	let next = 0;
	const worker = async () => {
		for (let index = next++; index < tasks.length; index = next++) {
			const task = tasks[index];
			if (task) results[index] = await task();
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(jobs, tasks.length) }, worker),
	);
	return results;
}

function parses(file: string, code: string): boolean {
	try {
		new Bun.Transpiler({
			loader: /\.[cm]?[jt]sx$/.test(file) ? "tsx" : "ts",
		}).transformSync(code);
		return true;
	} catch {
		return false;
	}
}

/** Bun resolves a test's imports and config from its package. */
function packageDirectory(file: string): string {
	for (let directory = dirname(file); ; directory = dirname(directory)) {
		if (existsSync(join(directory, "package.json"))) return directory;
		if (dirname(directory) === directory) return dirname(file);
	}
}
