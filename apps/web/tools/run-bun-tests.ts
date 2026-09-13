const files = Array.from(
	new Bun.Glob("src/**/*.bun-test.{ts,tsx}").scanSync(),
).sort();
if (!files.length) throw new Error("No Bun web tests found");
const run = Bun.spawn(
	[
		process.execPath,
		"test",
		"--tsconfig-override",
		"./tsconfig.app.json",
		...files.map((file) => `./${file}`),
	],
	{ stdout: "inherit", stderr: "inherit" },
);
process.exitCode = await run.exited;
export {};
