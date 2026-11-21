import { rm } from "node:fs/promises";
import { join } from "node:path";

const outdir = join(import.meta.dir, "dist");
await rm(outdir, { recursive: true, force: true });

// Both entrypoints are self-contained: an installed hook runtime is a copy of
// cli.js, and the published package has no dependencies.
for (const entrypoint of ["src/bin/cli.ts", "src/run-cli.ts"]) {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, entrypoint)],
		outdir,
		target: "node",
	});
	if (!result.success)
		throw new AggregateError(result.logs, "CLI build failed");
}
