import {
	copyFileSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const PROGRAMS = [
	"sed",
	"grep",
	"python3",
	"python",
	"cat",
	"git",
	"bun",
	"ls",
	"gh",
	"rg",
	"mkdir",
	"curl",
	"wc",
	"tail",
	"rm",
	"psql",
	"head",
	"find",
	"pkill",
	"cp",
	"which",
	"ps",
	"date",
	"echo",
	"nl",
	"tsc",
	"vite",
	"lsof",
	"node",
	"pwd",
	"ln",
	"kill",
	"du",
	"jq",
	"diff",
	"stat",
	"env",
	"df",
	"cut",
	"docker",
	"stripe",
	"vercel",
	"npm",
	"pnpm",
	"npx",
	"yarn",
	"tar",
	"unzip",
	"zip",
	"mv",
	"touch",
	"chmod",
	"sort",
	"uniq",
	"tr",
	"xargs",
	"tee",
	"make",
	"cargo",
	"go",
	"pip",
	"pip3",
	"uv",
	"pytest",
	"deno",
	"sudo",
	"ssh",
	"scp",
	"rsync",
	"brew",
	"kubectl",
	"less",
	"tree",
	"readlink",
	"basename",
	"dirname",
	"seq",
	"open",
	"code",
];

const USAGE =
	"Usage: bun scripts/extract-fig-specs.ts <path to @withfig/autocomplete>";

const packageDir = process.argv[2];
if (!packageDir) {
	console.error(USAGE);
	process.exit(1);
}
if (!existsSync(join(packageDir, "build"))) {
	console.error("Pass the path of an installed @withfig/autocomplete.");
	process.exit(1);
}
const outDir = join(import.meta.dir, "../src/command-glossary/generated/fig");

type Raw = Record<string, unknown> & {
	args?: unknown;
	description?: unknown;
	loadSpec?: unknown;
	name?: unknown;
	options?: unknown;
	parserDirectives?: Record<string, unknown>;
	subcommands?: unknown;
};

const list = <T>(value: unknown): T[] =>
	(Array.isArray(value) ? value : value == null ? [] : [value]) as T[];
const names = (value: unknown) => list<unknown>(value).map(String);
const text = (value: unknown) => {
	if (typeof value !== "string") return undefined;
	const clean = value
		.replace(/\s*\([^()]*specified by POSIX\.?\)/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
	return clean || undefined;
};

async function load(name: string): Promise<Raw | null> {
	const file = join(packageDir, "build", `${name}.js`);
	if (!existsSync(file)) return null;
	let spec = (await import(file)).default;
	if (typeof spec === "function") spec = spec();
	return spec && typeof spec === "object" ? (spec as Raw) : null;
}

const slimArg = (arg: Raw) => ({
	...(arg.name ? { n: String(arg.name) } : {}),
	...(text(arg.description) ? { d: text(arg.description) } : {}),
	...(arg.isOptional ? { o: 1 } : {}),
	...(arg.isVariadic ? { v: 1 } : {}),
	...(arg.isCommand || arg.isScript ? { c: 1 } : {}),
	...(arg.optionsCanBreakVariadicArg === false ? { nb: 1 } : {}),
});

const slimOption = (option: Raw) => ({
	n: names(option.name),
	...(text(option.description) ? { d: text(option.description) } : {}),
	...(list(option.args).length > 0
		? { a: list<Raw>(option.args).map(slimArg) }
		: {}),
	...(option.isPersistent ? { p: 1 } : {}),
	...(option.requiresSeparator || option.requiresEquals ? { s: 1 } : {}),
});

async function slimSubcommand(raw: Raw, depth: number): Promise<object> {
	let spec = raw;
	if (typeof spec.loadSpec === "string" && depth < 3) {
		const loaded = await load(spec.loadSpec);
		if (loaded)
			spec = {
				...loaded,
				...spec,
				description: spec.description ?? loaded.description,
				name: spec.name,
			};
	}
	const directives = spec.parserDirectives ?? {};
	const pd = {
		...(directives.flagsArePosixNoncompliant ? { np: 1 } : {}),
		...(directives.optionsMustPrecedeArguments ? { first: 1 } : {}),
		...(directives.optionArgSeparators
			? { sep: names(directives.optionArgSeparators) }
			: {}),
	};
	const subcommands: object[] = [];
	for (const sub of list<Raw>(spec.subcommands))
		if (sub && typeof sub === "object")
			subcommands.push(await slimSubcommand(sub, depth + 1));
	const options = list<Raw>(spec.options).filter(
		(option) => option && typeof option === "object",
	);
	return {
		n: names(spec.name),
		...(text(spec.description) ? { d: text(spec.description) } : {}),
		...(subcommands.length > 0 ? { s: subcommands } : {}),
		...(options.length > 0 ? { o: options.map(slimOption) } : {}),
		...(list(spec.args).length > 0
			? { a: list<Raw>(spec.args).map(slimArg) }
			: {}),
		...(Object.keys(pd).length > 0 ? { pd } : {}),
	};
}

rmSync(outDir, { force: true, recursive: true });
mkdirSync(outDir, { recursive: true });
const written: string[] = [];
const missing: string[] = [];
for (const program of PROGRAMS) {
	const spec = await load(program);
	if (!spec) {
		missing.push(program);
		continue;
	}
	// A module that parses its JSON, rather than a .json file: Vite serves a
	// JSON import as JavaScript, which a browser refuses under `type: "json"`,
	// and NodeNext typechecking wants that attribute on every JSON import.
	const json = JSON.stringify(await slimSubcommand(spec, 0));
	writeFileSync(
		join(outDir, `${program}.ts`),
		`// Generated from @withfig/autocomplete (MIT, Hercules Labs Inc.). Do not edit.\nimport type { FigSpec } from "../../fig-spec.js";\n\nexport default JSON.parse(${JSON.stringify(json)}) as FigSpec;\n`,
	);
	written.push(program);
}
copyFileSync(join(packageDir, "LICENSE"), join(outDir, "LICENSE"));
writeFileSync(
	join(outDir, "index.ts"),
	`// Generated by scripts/extract-fig-specs.ts from @withfig/autocomplete (MIT,
// Hercules Labs Inc.; see LICENSE here). Do not edit.
import type { FigSpec } from "../../fig-spec.js";

export const FIG_SPECS: Readonly<Record<string, () => Promise<FigSpec>>> = {
${written
	.map(
		(program) =>
			`\t${JSON.stringify(program)}: async () => (await import("./${program}.js")).default,`,
	)
	.join("\n")}
};
`,
);
console.log(
	`${written.length} specs written to ${outDir}; no Fig spec: ${missing.join(", ") || "none"}`,
);
