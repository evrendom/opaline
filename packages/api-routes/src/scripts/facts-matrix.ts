/**
 * Writes the Claude Code vs Codex fact matrix (docs/l1-fact-matrix.md) from
 * the fact catalog. With `--check`, writes nothing and exits 1 when the
 * committed file differs.
 *
 *   bun run --cwd packages/api-routes facts:matrix [-- --check]
 */
import {
	FACT_MATRIX_PATH,
	renderFactMatrix,
} from "../session-transcript/transcript-records/fact-matrix.js";

const path = new URL(`../../../../${FACT_MATRIX_PATH}`, import.meta.url)
	.pathname;
const matrix = renderFactMatrix();
if (process.argv.includes("--check")) {
	const file = Bun.file(path);
	const committed = (await file.exists()) ? await file.text() : "";
	if (committed !== matrix) {
		process.stderr.write(
			`${FACT_MATRIX_PATH} is out of date: run bun run --cwd packages/api-routes facts:matrix\n`,
		);
		process.exitCode = 1;
	}
} else {
	await Bun.write(path, matrix);
	process.stdout.write(`Wrote ${FACT_MATRIX_PATH}\n`);
}
