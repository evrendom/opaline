import type { SessionTurnStepKind } from "@rudel/api-routes";
import {
	classifyCommand,
	parseShellCommand,
} from "@rudel/api-routes/command-identity";

const FILE_PROGRAMS = new Set([
	"ack",
	"ag",
	"bat",
	"cat",
	"cp",
	"egrep",
	"fd",
	"fgrep",
	"find",
	"grep",
	"head",
	"less",
	"ls",
	"more",
	"mv",
	"nl",
	"python",
	"python3",
	"rg",
	"rm",
	"sed",
	"tail",
	"tee",
	"touch",
	"tree",
	"wc",
]);

const TRIVIAL_PROGRAMS = new Set([
	":",
	"cd",
	"echo",
	"export",
	"printf",
	"pwd",
	"set",
	"source",
	"true",
]);

const CHECKERS =
	/\b(?:astro check|svelte-check|svelte-kit check|vue-tsc|tsc)\b/u;

const programOf = (words: readonly string[]) =>
	(words.find((word) => !/^\w+=/u.test(word)) ?? "").split("/").at(-1) ?? "";

export type ChainRest = {
	lane: Extract<SessionTurnStepKind, "git" | "shell" | "verify">;
	parts: string[];
	filesFirst: boolean;
};

export function getChainRest(command: string): ChainRest | null {
	const pipelines: { text: string; program: string; redirects: number }[] = [];
	for (const simple of parseShellCommand(command)) {
		const last = pipelines.at(-1);
		if (simple.connector === "|" && last) {
			last.text += ` | ${simple.text}`;
			continue;
		}
		pipelines.push({
			program: programOf(simple.words),
			redirects: simple.redirects.length,
			text: simple.text,
		});
	}
	let filesFirst: boolean | null = null;
	const rest: string[] = [];
	for (const pipeline of pipelines) {
		const isFiles =
			FILE_PROGRAMS.has(pipeline.program) ||
			(TRIVIAL_PROGRAMS.has(pipeline.program) && pipeline.redirects > 0);
		if (isFiles) filesFirst ??= true;
		else if (!TRIVIAL_PROGRAMS.has(pipeline.program)) {
			filesFirst ??= false;
			rest.push(pipeline.text);
		}
	}
	if (rest.length === 0) return null;
	const joined = rest.join("; ");
	const kind = CHECKERS.test(joined) ? "typecheck" : classifyCommand(joined);
	return {
		filesFirst: filesFirst ?? false,
		lane:
			kind === "test" ||
			kind === "build" ||
			kind === "lint" ||
			kind === "typecheck"
				? "verify"
				: kind === "git"
					? "git"
					: "shell",
		parts: pipelines.map((pipeline) => pipeline.text),
	};
}
