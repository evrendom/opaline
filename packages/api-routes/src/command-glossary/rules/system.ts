import { code, file, files, plural, text } from "../sentence.js";
import {
	duration,
	explains,
	positionals,
	type Rule,
	values,
	writtenFlagNames,
} from "./context.js";

export const curl: Rule = (context) => {
	const url =
		positionals(context).find((arg) => /^https?:|^[\w.-]+\.\w+\//u.test(arg)) ??
		positionals(context)[0] ??
		"";
	const saveTo = values(context, "-o", "--output")[0];
	const method = values(context, "-X", "--request")[0];
	const data = values(
		context,
		"-d",
		"--data",
		"--data-raw",
		"--data-binary",
		"--data-urlencode",
		"-F",
		"--form",
		"--json",
	);
	const limit = values(context, "-m", "--max-time")[0];
	const user = values(context, "-u", "--user")[0];
	const headers = values(context, "-H", "--header");
	const writeOut = values(context, "-w", "--write-out")[0];
	explains(
		context,
		"-s",
		"--silent",
		"-S",
		"--show-error",
		"-f",
		"--fail",
		"-L",
		"--location",
		"-k",
		"--insecure",
	);
	const sent = data[0] ?? "";
	return {
		sentence: [
			...(data.length > 0
				? [
						text(method ? `Send a ${method} with ` : "Send "),
						code(sent.length > 80 ? `${sent.slice(0, 80)}…` : sent),
						text(" to "),
					]
				: [text(method ? `Send a ${method} request to ` : "Fetch ")]),
			code(url),
			...(user
				? [text(", logged in as "), code(user.split(":")[0] ?? "")]
				: []),
			...(headers.length > 0
				? [text(`, with ${plural(headers.length, "header")}`)]
				: []),
			...(saveTo && saveTo !== "/dev/null"
				? [text(", saved to "), file(saveTo)]
				: []),
			...(writeOut ? [text(", printing "), code(writeOut)] : []),
			...(limit ? [text(`, giving up after ${duration(limit)}`)] : []),
		],
		title: data.length > 0 || method ? "Send a request" : "Fetch a URL",
	};
};

export const lsof: Rule = (context) => {
	const takesValue = new Set(["i", "s", "p", "d", "c", "u", "F", "g"]);
	const set = new Map<string, string>();
	const unknown: string[] = [];
	const known = new Set([...takesValue, "t", "n", "P", "a", "l", "w", "V"]);
	const args = context.args;
	const files_: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const word = args[i] ?? "";
		if (!word.startsWith("-") || word === "-") {
			files_.push(word);
			continue;
		}
		for (let at = 1; at < word.length; at++) {
			const letter = word[at] ?? "";
			if (!known.has(letter)) {
				unknown.push(`-${letter}`);
				continue;
			}
			if (takesValue.has(letter)) {
				const rest = word.slice(at + 1);
				const next = args[i + 1] ?? "";
				set.set(
					letter,
					rest ||
						(letter !== "i" || /^(?::|@|\d|[46](?:$|[:@])|tcp|udp)/iu.test(next)
							? (args[++i] ?? "")
							: ""),
				);
				break;
			}
			set.set(letter, "");
		}
	}
	explains(
		context,
		...args.flatMap((word) =>
			word.startsWith("-") ? [word, ...writtenFlagNames(word)] : [],
		),
		...(context.parsed?.words.flatMap((word) =>
			word.kind === "option" ? word.option.n : [],
		) ?? []),
	);
	const port = set.get("i");
	const pid = set.get("p");
	const state = set.get("s");
	return {
		...(unknown.length > 0 ? { also: unknown } : {}),
		sentence: [
			...(port !== undefined
				? port
					? [text("See what is using "), code(port)]
					: [text("List the network connections")]
				: pid
					? [text("List the files process "), code(pid), text(" has open")]
					: [
							text("List the files processes have open"),
							...(files_.length > 0 ? [text(" among "), ...files(files_)] : []),
						]),
			...(state
				? /LISTEN$/u.test(state)
					? [text(", listening only")]
					: [text(", only "), code(state)]
				: []),
			...(set.get("d") ? [text(", only "), code(set.get("d") ?? "")] : []),
			...(set.has("t") ? [text(", process ids only")] : []),
		],
		title: port !== undefined ? "Check a port" : "Open files",
	};
};
