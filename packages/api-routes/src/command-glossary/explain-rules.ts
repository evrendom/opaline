import {
	duration,
	explains,
	type Filter,
	has,
	lineCount,
	positionals,
	type Rule,
	values,
} from "./rules/context.js";
import { copyMove, fileRule, find, rm } from "./rules/files.js";
import { gh } from "./rules/gh.js";
import { git } from "./rules/git.js";
import { interpreter, shell } from "./rules/interpreters.js";
import { packageManager } from "./rules/packages.js";
import { curl, lsof } from "./rules/system.js";
import {
	awk,
	awkWords,
	cat,
	cutWhat,
	grep,
	headTail,
	sed,
} from "./rules/text.js";
import { code, file, files, lines, list, text } from "./sentence.js";

export const EXPLAIN_RULES: Readonly<Record<string, Rule>> = {
	awk,
	cat,
	cd: (context) => ({
		quiet: true,
		sentence: [text("Go to "), file(context.args[0] ?? "~")],
		title: "Go to a folder",
	}),
	chmod: (context) => ({
		sentence: [
			text("Set the permissions of "),
			...files(positionals(context).slice(1)),
			text(" to "),
			code(positionals(context)[0] ?? ""),
		],
		title: "Permissions",
	}),
	cp: copyMove,
	curl,
	cut: (context) => {
		const cut = cutWhat(context);
		const paths = positionals(context);
		return cut
			? {
					sentence: [
						text(`Take ${cut.what} of each line`),
						...(paths.length > 0 ? [text(" of "), ...files(paths)] : []),
						...cut.split,
					],
					title: "Take columns",
				}
			: null;
	},
	date: (context) => {
		const format = context.args.find((arg) => arg.startsWith("+"));
		return {
			sentence: [
				text("Show the date and time"),
				...(has(context, "-u", "--utc", "--universal")
					? [text(" in UTC")]
					: []),
				...(format ? [text(", as "), code(format)] : []),
			],
			title: "Date",
		};
	},
	diff: (context) => ({
		sentence: [text("Compare "), ...files(positionals(context))],
		title: "Compare",
	}),
	readlink: (context) => ({
		sentence: [
			text("Show where "),
			...files(positionals(context)),
			text(
				has(context, "-f", "-e", "--canonicalize")
					? " leads, every link followed"
					: " points",
			),
		],
		title: "Follow a link",
	}),
	env: () => ({
		sentence: [text("Show the environment variables")],
		title: "Environment",
	}),
	echo: (context) => ({
		quiet: true,
		sentence:
			context.args.length > 0
				? [text("Print "), code(context.args.join(" "))]
				: [text("Print an empty line")],
		title: "Print",
	}),
	find,
	gh,
	git,
	grep,
	head: headTail,
	kill: (context) => ({
		sentence: [
			text("Stop the process "),
			...list(positionals(context).map(code)),
		],
		title: "Stop a process",
	}),
	ln: (context) => ({
		sentence: [
			text("Link "),
			file(positionals(context)[1] ?? ""),
			text(" to "),
			file(positionals(context)[0] ?? ""),
		],
		title: "Link",
	}),
	ls: (context) => ({
		sentence: [
			text("List "),
			...(positionals(context).length > 0
				? files(positionals(context))
				: [text("this folder")]),
			...(has(context, "-l") ? [text(", with details")] : []),
			...(has(context, "-a", "-A") ? [text(", hidden files included")] : []),
		],
		title: "List files",
	}),
	lsof,
	mkdir: fileRule("Create a folder", "Create the folder"),
	mv: copyMove,
	node: interpreter,
	npm: packageManager,
	pnpm: packageManager,
	bun: packageManager,
	bash: (context) => shell(context),
	sh: (context) => shell(context),
	zsh: (context) => shell(context),
	biome: (context) => {
		const [sub = "check"] = positionals(context);
		const write = has(context, "--write", "--apply");
		return {
			sentence: [
				text(sub === "format" ? "Format " : write ? "Lint and fix " : "Lint "),
				...files(
					positionals(context)
						.slice(1)
						.filter((p) => p !== "."),
				),
				...(positionals(context)
					.slice(1)
					.every((p) => p === ".")
					? [text("this folder")]
					: []),
			],
			title: sub === "format" ? "Format" : "Lint",
		};
	},
	claude: () => ({ sentence: [text("Run Claude Code")], title: "Claude Code" }),
	codex: () => ({ sentence: [text("Run Codex")], title: "Codex" }),
	file: (context) => ({
		sentence: [
			text("Tell what kind of file "),
			...files(positionals(context)),
			text(positionals(context).length > 1 ? " are" : " is"),
		],
		title: "File type",
	}),
	yarn: packageManager,
	pkill: (context) => ({
		sentence: [
			text("Stop the processes "),
			text(
				has(context, "-f", "--full")
					? "whose command line matches "
					: "named like ",
			),
			{ term: positionals(context)[0] ?? "" },
			...(has(context, "-l", "--list-name")
				? [text(", with their names")]
				: []),
			...(has(context, "-x", "--exact") ? [text(", exactly")] : []),
		],
		title: "Stop processes",
	}),
	pgrep: (context) => ({
		sentence: [
			text("Find the processes "),
			text(
				has(context, "-f", "--full")
					? "whose command line matches "
					: "named like ",
			),
			{ term: positionals(context)[0] ?? "" },
			...(has(context, "-l", "--list-name")
				? [text(", with their names")]
				: []),
			...(has(context, "-x", "--exact") ? [text(", exactly")] : []),
		],
		title: "Find processes",
	}),
	ps: (context) => {
		const pid = values(context, "-p", "--pid")[0];
		return pid
			? {
					sentence: [text("Show process "), code(pid)],
					title: "Look at a process",
				}
			: { sentence: [text("List the running processes")], title: "Processes" };
	},
	psql: (context) => ({
		sentence: [
			text("Run "),
			...(values(context, "-c", "--command")[0]
				? [code(values(context, "-c", "--command")[0] ?? "")]
				: [text("SQL")]),
			text(" on the database"),
		],
		title: "Query the database",
	}),
	python: interpreter,
	python3: interpreter,
	rg: grep,
	rm,
	sed,
	seq: (context) => {
		const numbers = positionals(context);
		const [from, step, to] =
			numbers.length >= 3
				? numbers
				: numbers.length === 2
					? [numbers[0], null, numbers[1]]
					: ["1", null, numbers[0]];
		return {
			sentence: [
				text(`Count from ${from ?? "1"} to ${to ?? ""}`),
				...(step ? [text(` in steps of ${step}`)] : []),
			],
			title: "Count",
		};
	},
	sleep: (context) => ({
		sentence: [text(`Wait ${duration(context.args[0] ?? "")}`)],
		title: "Wait",
	}),
	tail: headTail,
	touch: fileRule("Touch", "Create or update the timestamp of"),
	tsc: (context) => {
		const project = values(context, "-p", "--project")[0];
		explains(context, "--noEmit", "--pretty");
		return {
			sentence: [
				text("Check the types"),
				...(project ? [text(" of "), file(project)] : []),
				...(has(context, "-b", "--build")
					? [text(", project by project")]
					: []),
			],
			title: "Check types",
		};
	},
	wc: (context) => {
		const paths = positionals(context);
		return {
			sentence: [
				text(
					`Count the ${has(context, "-l", "--lines") ? "lines" : has(context, "-w", "--words") ? "words" : has(context, "-c", "--bytes") ? "bytes" : "lines, words and bytes"}`,
				),
				...(paths.length > 0 ? [text(" in "), ...files(paths)] : []),
			],
			title: "Count",
		};
	},
	which: (context) => ({
		sentence: [
			text("Find where "),
			code(positionals(context)[0] ?? ""),
			text(" is installed"),
		],
		title: "Find a program",
	}),
};

export const FILTER_RULES: Readonly<Record<string, Filter>> = {
	awk: (context) => {
		const { fromFile, notes, program } = awkWords(context);
		if (fromFile !== null)
			return [
				text("transformed by the awk program in "),
				file(fromFile),
				...notes,
			];
		const columns = /^\{\s*print\s+((?:\$\d+[\s,]*)+)\}$/u.exec(program.trim());
		return [
			...(columns
				? [
						text(
							`keeping column ${(columns[1] ?? "").match(/\d+/gu)?.join(", ")}`,
						),
					]
				: [text("transformed by "), code(program)]),
			...notes,
		];
	},
	cat: (context) => [
		text(
			has(context, "-A", "-v", "-e", "-t", "--show-all")
				? "with hidden characters shown"
				: has(context, "-n", "--number")
					? "with line numbers"
					: "as is",
		),
	],
	column: () => [text("lined up in columns")],
	cut: (context) => {
		const cut = cutWhat(context);
		return cut ? [text(`keeping ${cut.what}`), ...cut.split] : null;
	},
	grep: (context) => {
		const [first, second, ...rest] = grep(context).sentence;
		const verb = first && "text" in first ? first.text : "";
		const what = second && "text" in second ? second.text : "";
		const lead =
			verb === "Check for "
				? `checking for ${what}`
				: verb === "Count the "
					? `counting the ${what}`
					: verb === "Find the " && what.startsWith("lines not containing")
						? `dropping the ${what.replace("lines not containing", "lines containing")}`
						: `${verb.replace(/^Find the /u, "keeping the ").replace(/^List the /u, "listing the ")}${what}`;
		return [text(lead), ...rest];
	},
	head: (context) => [text(`keeping ${lines("first", lineCount(context))}`)],
	jq: (context) => [
		text("picking "),
		code(positionals(context)[0] ?? "."),
		text(" from the JSON"),
	],
	less: () => [text("paged")],
	nl: () => [text("with line numbers")],
	paste: (context) => {
		if (context.args.length > 1 && context.args.every((arg) => arg === "-"))
			return [text(`joined ${context.args.length} lines at a time`)];
		if (has(context, "-s", "--serial")) {
			const by = values(context, "-d", "--delimiters")[0];
			return [
				text("joined into one line"),
				...(by ? [text(" by "), code(by)] : []),
			];
		}
		return null;
	},
	rg: (context) => FILTER_RULES.grep?.(context) ?? null,
	sed: (context) => {
		const [first, ...rest] = sed(context).sentence;
		const lead = first && "text" in first ? first.text : "";
		const reworded = lead
			.replace(/^Show /u, "keeping ")
			.replace(/^Print with /u, "with ")
			.replace(/^Remove the lines/u, "dropping the lines")
			.replace(/^Run the sed script /u, "rewritten by ");
		return [text(reworded), ...rest];
	},
	sort: (context) => [
		text(
			`sorted${has(context, "-n", "--numeric-sort") ? " by number" : ""}${has(context, "-r", "--reverse") ? ", largest first" : ""}${has(context, "-u", "--unique") ? ", without repeats" : ""}`,
		),
	],
	tail: (context) => {
		const from =
			values(context, "-n", "--lines")[0] ??
			context.args.find((arg) => /^\+/u.test(arg));
		return from?.startsWith("+")
			? /^\+\d+$/u.test(from)
				? [text(`keeping from line ${from.slice(1)} on`)]
				: [text("keeping from line "), code(from.slice(1)), text(" on")]
			: [text(`keeping ${lines("last", lineCount(context))}`)];
	},
	tee: (context) => [text("saving a copy to "), ...files(positionals(context))],
	tr: () => [text("with characters translated")],
	uniq: (context) => [
		text(
			has(context, "-c", "--count")
				? "counting the repeats"
				: "without repeats",
		),
	],
	wc: (context) => [
		text(`counting the ${has(context, "-l", "--lines") ? "lines" : "words"}`),
	],
	xargs: (context) => [
		text("running "),
		code(context.args.filter((arg) => !arg.startsWith("-")).join(" ")),
		text(" on each"),
	],
};
